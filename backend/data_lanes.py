"""
LevelFlip provider lanes
========================

Every upstream market-data source is a lane behind one of two interfaces:

  ChainFetcher  -> morning OI/IV anchor (multi-expiry), same shape as
                   YFinanceChainFetcher in main.py
  SpotFeed      -> real-time spot (1s poll cadence)
  NewsFetcher   -> headline feed for the AI desk brief

Lane order (first provider that returns usable data wins):

  chain: LSE -> Alpha Vantage (EOD OI baseline, 25-call/day budget) -> yfinance
  spot : Finnhub -> FMP -> yfinance                (equities/ETFs)
         CBOE  -> Finnhub -> FMP                   (futures)
  news : Market Aux -> NewsAPI

A lane is a thin adapter: fetch, normalize, fail soft. Lanes never raise —
they return None (or an empty list) so the next lane gets its turn. The
lse-data client is preferred for chains when its key works; the API contract
is checked defensively because live field names were unverifiable at build
time (key returned 401).
"""

from __future__ import annotations

import logging
import os
import threading
import time
from dataclasses import dataclass
from typing import Dict, List, Optional

import numpy as np
import requests

log = logging.getLogger("levelflip.lanes")


# ---------------------------------------------------------------------------
# Failure cooldown — a lane that fails hard (bad key, 429, DNS) is parked for
# FAIL_COOLDOWN_SECONDS instead of being hammered every refresh cycle.
# ---------------------------------------------------------------------------

FAIL_COOLDOWN_SECONDS = 600.0


class _Cooldown:
    def __init__(self, seconds: float = FAIL_COOLDOWN_SECONDS) -> None:
        self._seconds = seconds
        self._until: Dict[str, float] = {}
        self._lock = threading.Lock()

    def trip(self, key: str) -> None:
        with self._lock:
            self._until[key] = time.time() + self._seconds

    def clear(self, key: str) -> None:
        with self._lock:
            self._until.pop(key, None)

    def blocked(self, key: str) -> bool:
        with self._lock:
            until = self._until.get(key)
            return until is not None and until > time.time()


_COOLDOWNS = _Cooldown()


# ---------------------------------------------------------------------------
# Chain lanes (anchor: strikes / OI / volume / IV per expiry)
# ---------------------------------------------------------------------------

@dataclass
class ChainData:
    """Mirror of main.py's ChainData — kept here so lanes are self-contained."""

    ticker: str
    expiry: str
    strikes: np.ndarray
    oi_calls: np.ndarray
    oi_puts: np.ndarray
    vol_calls: np.ndarray
    vol_puts: np.ndarray
    iv: np.ndarray


class LSEChainFetcher:
    """Options chain via London Strategic Edge (lse-data).

    The LSE chain (one row per contract) carries IV, delta, gamma, vega and
    premium — but NO open interest, so it cannot anchor GEX (OI math). Its
    roles here:

      fetch()  -> OI-gated GEX-anchor lane. Probes the schema once per
                  process; the LSE chain has no OI fields, so it returns None
                  and the GEX anchor falls through to AV/yfinance. If LSE
                  ever adds OI, the probe re-enables it automatically.
      vol()    -> rich per-expiry grids (iv/delta/gamma/vega/premium) for the
                  vol-surface endpoint. This is the live IV source.

    The vault ignores min_dte/max_dte on the chain endpoint and returns rows
    from the *oldest* expiries in the store, so near-term expiries are
    fetched explicitly — one call per upcoming Friday (weekly + monthly
    cycles), merged and cached per ticker for 5 minutes.
    """

    label = "lse"
    ROWS_TTL_SECONDS = 300.0

    def __init__(self) -> None:
        self._client = None
        self._client_lock = threading.Lock()
        self._key = _lse_key()
        self._rows_cache: Dict[str, tuple] = {}   # ticker -> (fetched_ts, rows)
        self._rows_lock = threading.Lock()
        self._oi_absent = False

    def _lse(self):
        if self._client is not None:
            return self._client
        with self._client_lock:
            if self._client is None:
                from lse import LSE

                self._client = LSE(api_key=self._key) if self._key else None
        return self._client

    @staticmethod
    def _upcoming_fridays(count: int = 8) -> List[str]:
        """Next `count` expiry dates — SPY weeklies/monthlies fall on Fridays."""
        import datetime as _dt
        today = _dt.date.today()
        days_ahead = (4 - today.weekday()) % 7  # Friday
        first = today + _dt.timedelta(days=days_ahead or 7)
        return [(first + _dt.timedelta(weeks=i)).isoformat() for i in range(count)]

    def _fetch_rows(self, ticker: str) -> Optional[List[dict]]:
        """All near-term LSE chain rows for a ticker (per-Friday calls, cached)."""
        with self._rows_lock:
            cached = self._rows_cache.get(ticker)
            if cached and time.time() - cached[0] < self.ROWS_TTL_SECONDS:
                return cached[1]
        if _COOLDOWNS.blocked(f"lse:{ticker}"):
            return None
        client = self._lse()
        if client is None:
            return None

        merged: List[dict] = []
        failures = 0
        for expiry in self._upcoming_fridays():
            try:
                rows = client.options(ticker, expiry=expiry, limit=5000) or []
                # Keep only the fields the engine consumes — trims ~40k dicts to
                # a manageable footprint
                for r in rows:
                    merged.append(
                        {
                            "strike": r.get("strike"),
                            "expiry": str(r.get("expiry", ""))[:10],
                            "dte": r.get("dte"),
                            "contract_type": str(r.get("contract_type") or "").lower(),
                            "iv": r.get("iv"),
                            "delta": r.get("delta"),
                            "gamma": r.get("gamma"),
                            "vega": r.get("vega"),
                            "last_price": r.get("last_price"),
                            "premium_today": r.get("premium_today"),
                            "underlying_price": r.get("underlying_price"),
                        }
                    )
            except Exception:
                failures += 1
        if not merged:
            if failures:
                log.warning("LSE chain failed for %s (%d expiries) — cooling down", ticker, failures)
                _COOLDOWNS.trip(f"lse:{ticker}")
            return None
        with self._rows_lock:
            self._rows_cache[ticker] = (time.time(), merged)
        log.info("LSE chain: %d rows (%d expiries, %d failed) for %s", len(merged), len(self._upcoming_fridays()) - failures, failures, ticker)
        return merged

    # -- GEX-anchor lane (OI-gated) ---------------------------------------

    def fetch(self, ticker: str) -> Optional[List[ChainData]]:
        if not self._key:
            return None
        if self._oi_absent:
            return None  # schema probed once — no OI, cannot anchor GEX
        rows = self._fetch_rows(ticker)
        if not rows:
            return None
        oi_key = _pick_key(rows[0], ("open_interest", "openInterest", "oi"))
        if oi_key is None:
            self._oi_absent = True
            log.info(
                "LSE chain has no open interest field (keys: %s) — GEX anchor falls through; "
                "LSE feeds the vol surface instead",
                sorted(rows[0].keys()),
            )
            return None
        # Schema has OI (future-proofing): build ChainData per expiry
        by_expiry: Dict[str, dict] = {}
        for row in rows:
            exp = str(row.get("expiry") or row.get("expiration") or "").split("T")[0]
            if not exp:
                continue
            right = str(row.get("type") or row.get("contract_type") or row.get("right") or "").lower()
            try:
                strike = float(row.get("strike"))
            except (TypeError, ValueError):
                continue
            bucket = by_expiry.setdefault(exp, {"strike": [], "calls": {}, "puts": {}, "iv": {}, "vol": {}})
            bucket["strike"].append(strike)
            oi = _num(row.get(oi_key), 0.0)
            iv = _num(row.get("iv"), 0.0)
            vol = _num(row.get("volume_today") or row.get("volume"), 0.0)
            if right == "call":
                bucket["calls"][strike] = oi
                bucket["iv"][strike] = iv
                bucket["vol"][strike] = vol
            elif right == "put":
                bucket["puts"][strike] = oi
                bucket["iv"][strike] = max(bucket["iv"].get(strike, 0.0), iv)
                bucket["vol"][strike] = vol

        chains: List[ChainData] = []
        for exp, b in sorted(by_expiry.items()):
            strikes = np.array(sorted(set(b["strike"])), dtype=np.float64)
            chains.append(
                ChainData(
                    ticker=ticker,
                    expiry=exp,
                    strikes=strikes,
                    oi_calls=np.array([b["calls"].get(s, 0.0) for s in strikes], dtype=np.float64),
                    oi_puts=np.array([b["puts"].get(s, 0.0) for s in strikes], dtype=np.float64),
                    vol_calls=np.array([b["vol"].get(s, 0.0) for s in strikes], dtype=np.float64),
                    vol_puts=np.zeros(len(strikes)),
                    iv=np.array([b["iv"].get(s, 0.0) for s in strikes], dtype=np.float64),
                )
            )
        return chains or None

    # -- Vol surface feed (live IV + greeks, OI-free) ----------------------

    def vol(self, ticker: str) -> Optional[dict]:
        """Per-expiry grids for the vol surface: strikes x {iv, delta, gamma, vega}."""
        if not self._key:
            return None
        rows = self._fetch_rows(ticker)
        if not rows:
            return None
        spot = next((_num(r.get("underlying_price"), None) for r in rows if r.get("underlying_price")), None)

        by_expiry: Dict[str, dict] = {}
        for r in rows:
            exp = str(r.get("expiry", ""))[:10]
            if not exp:
                continue
            try:
                strike = float(r.get("strike"))
            except (TypeError, ValueError):
                continue
            b = by_expiry.setdefault(
                exp,
                {"dte": _num(r.get("dte"), 0), "calls": {}, "puts": {}},
            )
            side = b["calls"] if r.get("contract_type") == "call" else b["puts"]
            side[strike] = {
                "iv": _num(r.get("iv"), None),
                "delta": _num(r.get("delta"), None),
                "gamma": _num(r.get("gamma"), None),
                "vega": _num(r.get("vega"), None),
                "premium": _num(r.get("premium_today"), 0.0),
            }

        expiries = []
        for exp, b in sorted(by_expiry.items()):
            strikes = sorted(set(b["calls"]) | set(b["puts"]))
            if not strikes:
                continue
            expiries.append(
                {
                    "expiry": exp,
                    "dte": int(b["dte"]),
                    "strikes": strikes,
                    "call_iv": [b["calls"].get(s, {}).get("iv") for s in strikes],
                    "put_iv": [b["puts"].get(s, {}).get("iv") for s in strikes],
                    "delta": [b["calls"].get(s, {}).get("delta") for s in strikes],
                    "gamma": [
                        b["calls"].get(s, {}).get("gamma") or b["puts"].get(s, {}).get("gamma")
                        for s in strikes
                    ],
                    "vega": [b["calls"].get(s, {}).get("vega") for s in strikes],
                    "premium": [b["calls"].get(s, {}).get("premium", 0.0) for s in strikes],
                }
            )
        if not expiries:
            return None
        log.info("LSE vol surface: %d expiries for %s", len(expiries), ticker)
        return {"spot": spot, "expiries": expiries}


class AlphaVantageChainFetcher:
    """EOD OI baseline via Alpha Vantage OPTIONS_CHAIN.

    Budget: 25 calls/day on the free tier — spent once per ticker per day
    (the chain cache already gives it a 1-hour TTL; this lane is the anchor
    of last resort after LSE). A per-process daily counter parks the lane
    when the budget is exhausted.
    """

    label = "alpha_vantage"
    DAILY_BUDGET = 20  # stay under the 25/day cap

    def __init__(self) -> None:
        self._key = os.getenv("VANTAGE_API_KEY")
        self._used_today: Dict[str, int] = {}
        self._lock = threading.Lock()

    def _budget_left(self) -> bool:
        today = time.strftime("%Y-%m-%d")
        with self._lock:
            if self._used_today.get("day") != today:
                self._used_today = {"day": today, "calls": 0}
            return self._used_today["calls"] < self.DAILY_BUDGET

    def _spend(self) -> None:
        with self._lock:
            self._used_today["calls"] = self._used_today.get("calls", 0) + 1

    def fetch(self, ticker: str) -> Optional[List[ChainData]]:
        if not self._key:
            return None
        if not self._budget_left():
            log.info("AV lane: daily budget exhausted — skipping %s", ticker)
            return None
        if _COOLDOWNS.blocked(f"av:{ticker}"):
            return None
        url = "https://www.alphavantage.co/query"
        try:
            resp = requests.get(
                url,
                params={"function": "OPTIONS_CHAIN", "symbol": ticker, "apikey": self._key},
                timeout=20.0,
            )
            body = resp.json()
            self._spend()
        except Exception as exc:
            log.warning("AV chain failed for %s: %s", ticker, exc)
            return None
        if not isinstance(body, dict):
            return None
        note = body.get("Note") or body.get("Information")
        if note:
            log.info("AV lane: %s", str(note)[:120])
            _COOLDOWNS.trip(f"av:{ticker}")
            return None
        rows = body.get("options") or []
        if not rows:
            return None

        by_expiry: Dict[str, dict] = {}
        for row in rows:
            exp = str(row.get("expiration", ""))[:10]
            if not exp:
                continue
            right = str(row.get("type", "")).lower()
            try:
                strike = float(row.get("strike"))
            except (TypeError, ValueError):
                continue
            bucket = by_expiry.setdefault(exp, {"strike": [], "calls": {}, "puts": {}, "iv": {}, "vol": {}})
            bucket["strike"].append(strike)
            oi = _num(row.get("open_interest"), 0.0)
            iv = _num(row.get("implied_volatility"), 0.0)
            vol = _num(row.get("volume"), 0.0)
            if right == "call":
                bucket["calls"][strike] = oi
                bucket["iv"][strike] = iv
                bucket["vol"][strike] = vol
            elif right == "put":
                bucket["puts"][strike] = oi
                bucket["iv"][strike] = max(bucket["iv"].get(strike, 0.0), iv)
                bucket["vol"][strike] = vol

        chains: List[ChainData] = []
        for exp, b in sorted(by_expiry.items()):
            strikes = np.array(sorted(set(b["strike"])), dtype=np.float64)
            chains.append(
                ChainData(
                    ticker=ticker,
                    expiry=exp,
                    strikes=strikes,
                    oi_calls=np.array([b["calls"].get(s, 0.0) for s in strikes], dtype=np.float64),
                    oi_puts=np.array([b["puts"].get(s, 0.0) for s in strikes], dtype=np.float64),
                    vol_calls=np.array([b["vol"].get(s, 0.0) for s in strikes], dtype=np.float64),
                    vol_puts=np.zeros(len(strikes)),
                    iv=np.array([b["iv"].get(s, 0.0) for s in strikes], dtype=np.float64),
                )
            )
        log.info("AV chain: %d expiries for %s (call spent)", len(chains), ticker)
        return chains or None


class FallbackChainFetcher:
    """Chain lane selector: first provider with data wins, in declared order."""

    label = "fallback"

    def __init__(self, lanes: List[object]) -> None:
        self._lanes = lanes

    def fetch(self, ticker: str) -> Optional[List[ChainData]]:
        for lane in self._lanes:
            try:
                data = lane.fetch(ticker)
            except Exception as exc:  # a lane must never kill the anchor
                log.warning("Lane %s crashed for %s: %s", getattr(lane, "label", "?"), ticker, exc)
                data = None
            if data:
                log.info("Chain anchor for %s <- lane %s", ticker, getattr(lane, "label", "?"))
                return data
        return None


# ---------------------------------------------------------------------------
# Spot lanes (real-time price)
# ---------------------------------------------------------------------------

class FinnhubSpotFeed:
    """Finnhub /quote REST — sub-second, primary equity/ETF spot lane."""

    label = "finnhub"

    def __init__(self) -> None:
        self._key = os.getenv("FINNHUB_API_KEY")
        self._session = requests.Session()

    def fetch(self, ticker: str) -> Optional[float]:
        if not self._key:
            return None
        try:
            resp = self._session.get(
                "https://finnhub.io/api/v1/quote",
                params={"symbol": ticker.upper(), "token": self._key},
                timeout=5.0,
            )
            if resp.status_code != 200:
                return None
            price = resp.json().get("c")
            return float(price) if isinstance(price, (int, float)) and price > 0 else None
        except Exception:
            return None


class FMPSpotFeed:
    """Financial Modeling Prep /quote — fallback spot lane."""

    label = "fmp"

    def __init__(self) -> None:
        self._key = os.getenv("FMP_API_KEY")
        self._session = requests.Session()

    def fetch(self, ticker: str) -> Optional[float]:
        if not self._key:
            return None
        try:
            resp = self._session.get(
                f"https://financialmodelingprep.com/api/v3/quote/{ticker.upper()}",
                params={"apikey": self._key},
                timeout=5.0,
            )
            if resp.status_code != 200:
                return None
            rows = resp.json()
            if not isinstance(rows, list) or not rows:
                return None
            price = rows[0].get("price")
            return float(price) if isinstance(price, (int, float)) and price > 0 else None
        except Exception:
            return None


# ---------------------------------------------------------------------------
# News lanes (desk-brief context)
# ---------------------------------------------------------------------------

@dataclass
class NewsItem:
    title: str
    source: str
    url: str
    published_at: str = ""


class MarketAuxNewsFetcher:
    """Market Aux live financial headlines, optionally filtered by ticker."""

    label = "marketaux"

    def __init__(self) -> None:
        self._key = os.getenv("MARKETAUX_API_KEY")
        self._session = requests.Session()

    def fetch(self, ticker: Optional[str] = None, limit: int = 5) -> List[NewsItem]:
        if not self._key:
            return []
        try:
            params: Dict[str, object] = {
                "api_token": self._key,
                "language": "en",
                "limit": limit,
                "filter_entities": True,
            }
            if ticker:
                params["symbols"] = ticker
            resp = self._session.get("https://api.marketaux.com/v1/news/all", params=params, timeout=8.0)
            if resp.status_code != 200:
                return []
            data = resp.json().get("data") or []
            return [
                NewsItem(
                    title=it.get("title", ""),
                    source=(it.get("source") or {}).get("name", "") if isinstance(it.get("source"), dict) else "",
                    url=it.get("url", ""),
                    published_at=str(it.get("published_at", ""))[:16],
                )
                for it in data
                if it.get("title")
            ]
        except Exception:
            return []


class NewsAPIFetcher:
    """NewsAPI.org fallback (everything endpoint, ticker keyword)."""

    label = "newsapi"

    def __init__(self) -> None:
        self._key = os.getenv("NEWS_API_KEY")
        self._session = requests.Session()

    def fetch(self, ticker: Optional[str] = None, limit: int = 5) -> List[NewsItem]:
        if not self._key:
            return []
        try:
            resp = self._session.get(
                "https://newsapi.org/v2/everything",
                params={"q": ticker or "stock market", "language": "en", "pageSize": limit, "apiKey": self._key},
                timeout=8.0,
            )
            if resp.status_code != 200:
                return []
            return [
                NewsItem(
                    title=a.get("title", ""),
                    source=(a.get("source") or {}).get("name", ""),
                    url=a.get("url", ""),
                    published_at=str(a.get("publishedAt", ""))[:16],
                )
                for a in (resp.json().get("articles") or [])
                if a.get("title")
            ]
        except Exception:
            return []


class FallbackNewsFetcher:
    """News lane selector: Market Aux first, NewsAPI second."""

    label = "news"

    def __init__(self, lanes: Optional[List[object]] = None) -> None:
        self._lanes = lanes or [MarketAuxNewsFetcher(), NewsAPIFetcher()]

    def fetch(self, ticker: Optional[str] = None, limit: int = 5) -> List[NewsItem]:
        for lane in self._lanes:
            try:
                items = lane.fetch(ticker=ticker, limit=limit)
            except Exception:
                items = []
            if items:
                return items
        return []


# ---------------------------------------------------------------------------
# LSE options flow (needs a live LSE key; degrades to 502 at the route)
# ---------------------------------------------------------------------------

class LSEOptionsFlow:
    label = "lse_flow"

    def __init__(self) -> None:
        self._client = None
        self._key = _lse_key()

    def _lse(self):
        if self._client is not None:
            return self._client
        if not self._key:
            return None
        from lse import LSE

        self._client = LSE(api_key=self._key)
        return self._client

    def fetch(self, ticker: str, min_premium: float = 100_000.0) -> List[dict]:
        """Raw LSE prints, normalized to flat dicts for the /flow endpoint."""
        if not self._key or _COOLDOWNS.blocked(f"flow:{ticker}"):
            return []
        try:
            rows = self._lse().options_flow(ticker, min_premium=min_premium, limit=100)
        except Exception as exc:
            log.warning("LSE flow failed for %s: %s", ticker, exc)
            _COOLDOWNS.trip(f"flow:{ticker}")
            return []
        out = []
        for r in rows:
            out.append(
                {
                    "contract": r.get("contract") or r.get("ticker") or "",
                    "type": str(r.get("contract_type") or r.get("type") or r.get("right") or "").upper(),
                    "strike": _num(r.get("strike"), None),
                    "expiry": str(r.get("expiry") or r.get("expiration") or "")[:10],
                    "premium": _num(r.get("premium"), 0.0),
                    "price": _num(r.get("price") or r.get("last_price") or r.get("trade_price"), None),
                    "volume": _num(r.get("volume") or r.get("size"), 0),
                    "side": str(r.get("side") or r.get("option_side") or "").upper() or None,
                    "timestamp": str(r.get("ts") or r.get("timestamp") or r.get("time") or "")[:19],
                    "dte": _num(r.get("dte"), None),
                    "delta": _num(r.get("delta"), None),
                }
            )
        return out


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _lse_key() -> Optional[str]:
    """Live key first (lse_live_...), then the legacy placeholders."""
    return (
        os.getenv("London_STRATEGIC_EDGE_API_KEY_LIVE")
        or os.getenv("LSE_API_KEY")
        or os.getenv("London_STRATEGIC_EDGE_API_KEY")
    )


def _pick_key(row: dict, candidates: tuple) -> Optional[str]:
    for k in candidates:
        if k in row:
            return k
    return None


def _num(value, default):
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default
