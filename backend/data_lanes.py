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

    Returns ChainData rows per expiry when the payload includes open interest
    (GEX needs OI). If the API contract lacks OI fields, or the key is invalid
    (401), the lane degrades to None and the caller falls through to the next
    chain lane. Invalid keys trip a cooldown so we stop paying for them.
    """

    label = "lse"

    def __init__(self) -> None:
        self._client = None
        self._client_lock = threading.Lock()
        self._key = os.getenv("LSE_API_KEY") or os.getenv("London_STRATEGIC_EDGE_API_KEY")

    def _lse(self):
        if self._client is not None:
            return self._client
        with self._client_lock:
            if self._client is None:
                from lse import LSE

                self._client = LSE(api_key=self._key) if self._key else None
        return self._client

    def fetch(self, ticker: str) -> Optional[List[ChainData]]:
        if not self._key:
            log.info("LSE lane: no API key configured — skipping")
            return None
        if _COOLDOWNS.blocked(f"lse:{ticker}"):
            return None
        client = self._lse()
        if client is None:
            return None
        try:
            rows = client.options(ticker, max_dte=60, limit=5000)
            if not rows:
                return None
        except Exception as exc:  # 401 / 429 / timeout — park the lane
            log.warning("LSE chain failed for %s: %s — cooling down", ticker, exc)
            _COOLDOWNS.trip(f"lse:{ticker}")
            return None

        first = rows[0]
        oi_key = _pick_key(first, ("open_interest", "openInterest", "oi"))
        iv_key = _pick_key(first, ("implied_volatility", "impliedVolatility", "iv"))
        vol_key = _pick_key(first, ("volume", "vol"))
        if oi_key is None:
            log.warning(
                "LSE chain for %s has no open interest field (keys: %s) — cannot compute GEX, falling through",
                ticker,
                sorted(first.keys()),
            )
            return None

        by_expiry: Dict[str, dict] = {}
        for row in rows:
            exp = str(row.get("expiry") or row.get("expiration") or "").split("T")[0]
            if not exp:
                continue
            right = str(row.get("type") or row.get("right") or "").lower()
            strike = row.get("strike")
            try:
                strike = float(strike)
            except (TypeError, ValueError):
                continue
            bucket = by_expiry.setdefault(exp, {"strike": [], "calls": {}, "puts": {}, "iv": {}, "vol": {}})
            bucket["strike"].append(strike)
            oi = _num(row.get(oi_key), 0.0)
            iv = _num(row.get(iv_key), 0.0) if iv_key else 0.0
            vol = _num(row.get(vol_key), 0.0) if vol_key else 0.0
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
            oic = np.array([b["calls"].get(s, 0.0) for s in strikes], dtype=np.float64)
            oip = np.array([b["puts"].get(s, 0.0) for s in strikes], dtype=np.float64)
            iv = np.array([b["iv"].get(s, 0.0) for s in strikes], dtype=np.float64)
            voc = np.array([b["vol"].get(s, 0.0) for s in strikes], dtype=np.float64)
            vop = np.zeros_like(voc)
            chains.append(
                ChainData(ticker=ticker, expiry=exp, strikes=strikes, oi_calls=oic,
                          oi_puts=oip, vol_calls=voc, vol_puts=vop, iv=iv)
            )
        log.info("LSE chain: %d expiries for %s", len(chains), ticker)
        return chains or None


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
        self._key = os.getenv("LSE_API_KEY") or os.getenv("London_STRATEGIC_EDGE_API_KEY")

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
                    "type": str(r.get("type") or r.get("right") or "").upper(),
                    "strike": _num(r.get("strike"), None),
                    "expiry": str(r.get("expiry") or r.get("expiration") or "")[:10],
                    "premium": _num(r.get("premium"), 0.0),
                    "price": _num(r.get("price") or r.get("trade_price"), None),
                    "volume": _num(r.get("volume") or r.get("size"), 0),
                    "side": str(r.get("side") or r.get("option_side") or "").upper() or None,
                    "timestamp": str(r.get("timestamp") or r.get("time") or "")[:19],
                }
            )
        return out


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

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
