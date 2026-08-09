"""
LevelFlip FastAPI Microservice
==============================

Hybrid ingestion pipeline:

  Anchor   - options chain (strikes/OI/volume/IV) fetched from yfinance,
             cached in a TTL-3600 cachetools cache, refreshed lazily after
             30 minutes, and flagged `chain_stale` when serving an old anchor.
  Catalyst - spot price streamed by a background poller (1-second cadence):
             * yfinance fast-info polling for equities/ETFs (SPY, QQQ, NVDA)
             * CBOE public delayed-quotes JSON for futures (ES, NQ, YM, RTY)
             The feed is pluggable behind a SpotFeed interface (StockSocket
             is deprecated/dead per audit update #1 — never wired in).

Every market-data response is served from cachetools.TTLCache (2-second
payload TTL). Zero external databases, zero ORMs.

Routes:
  GET /api/v1/iof?ticker=SPY&include_analysis=true  -> full LevelFlip payload
  GET /health                                       -> liveness
"""

from __future__ import annotations

import logging
import os
import re
import threading
import time
from abc import ABC, abstractmethod
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import requests
import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from llm_analyst import AnalystNote, LLMAnalyst
from quant_engine import LockedTTLCache, QuantEngine

try:
    from dotenv import load_dotenv

    load_dotenv()  # picks up .env with API keys
except ImportError:  # pragma: no cover
    pass

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("levelflip")

DEFAULT_TICKER = os.getenv("DEFAULT_TICKER", "SPY")

# Futures that only CBOE (not yfinance) can serve delayed quotes for
FUTURES_TICKERS = {"ES", "NQ", "YM", "RTY", "MES", "MNQ", "M2K", "MYM"}

# Cache geometry — all cachetools.TTLCache, in-memory, no DBs
SPOT_TTL_SECONDS = 1.0
CHAIN_TTL_SECONDS = 3600.0          # anchor lifetime (morning OI)
CHAIN_REFRESH_SECONDS = 1800.0      # lazily re-anchor after 30 min
CHAIN_STALE_AFTER_SECONDS = 5400.0  # flag payloads served from an old anchor
PAYLOAD_TTL_SECONDS = 2.0
CANDLES_TTL_SECONDS = 30.0          # 1-minute bars only change once a minute

_TICKER_PATTERN = re.compile(r"^[A-Z0-9._^/-]{1,12}$")


# ---------------------------------------------------------------------------
# API contract — mirrored verbatim in frontend/types/levelFlip.ts (Phase 2)
# ---------------------------------------------------------------------------

class GexBar(BaseModel):
    strike: float
    gex: float
    oi_calls: int
    oi_puts: int
    iv: float


class IOFPayload(BaseModel):
    ticker: str
    spot_price: float
    as_of: str
    call_wall: float
    put_wall: float
    gamma_flip: float
    max_pain: float
    expected_move: float
    atm_iv: float
    net_gex: float
    chain_stale: bool
    gex_profile: List[GexBar]
    analysis: Optional[AnalystNote] = None


class CandleBar(BaseModel):
    time: int  # unix seconds (UTC)
    open: float
    high: float
    low: float
    close: float


class CandlesPayload(BaseModel):
    ticker: str
    interval: str
    candles: List[CandleBar]


# ---------------------------------------------------------------------------
# Pluggable real-time spot feeds
# ---------------------------------------------------------------------------

class SpotFeed(ABC):
    """Real-time spot ingestion adapter (pluggable; 1s polling cadence)."""

    label = "base"

    @abstractmethod
    def fetch(self, ticker: str) -> Optional[float]:
        """Return the latest price for `ticker`, or None if unavailable."""


class YFinanceSpotFeed(SpotFeed):
    """Equity/ETF spot feed via yfinance fast-info quotes."""

    label = "yfinance"

    def __init__(self) -> None:
        from yfinance import Ticker

        self._ticker_cls = Ticker
        self._instances: Dict[str, Any] = {}
        self._lock = threading.Lock()

    def _ticker(self, symbol: str) -> Any:
        with self._lock:
            inst = self._instances.get(symbol)
            if inst is None:
                inst = self._ticker_cls(symbol)
                self._instances[symbol] = inst
            return inst

    def fetch(self, ticker: str) -> Optional[float]:
        try:
            price = float(self._ticker(ticker).fast_info["last_price"])
            if price > 0:
                return price
        except Exception:
            pass
        try:  # last resort: last 1-minute bar close
            hist = self._ticker(ticker).history(period="1d", interval="1m")
            if not hist.empty:
                price = float(hist["Close"].iloc[-1])
                if price > 0:
                    return price
        except Exception:
            pass
        return None


class CBOEFuturesSpotFeed(SpotFeed):
    """Delayed (~15 min) futures quotes from CBOE's public CDN JSON.

    URL pattern: https://cdn.cboe.com/api/global/delayed_quotes/futures/_ES.json
    Delayed is acceptable: the anchor is morning OI; the spot only needs to
    track broad direction between chain refreshes.
    """

    label = "cboe"

    def __init__(self) -> None:
        self._session = requests.Session()
        self._session.headers.update({"User-Agent": "Mozilla/5.0 (LevelFlip/0.1)"})

    def fetch(self, ticker: str) -> Optional[float]:
        url = f"https://cdn.cboe.com/api/global/delayed_quotes/futures/_{ticker.upper()}.json"
        try:
            resp = self._session.get(url, timeout=6.0)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            body = resp.json()
        except Exception:
            return None

        data = body.get("data") if isinstance(body, dict) else None
        rows = data if isinstance(data, list) else ([data] if isinstance(data, dict) else [])
        for row in rows:
            for key in ("current_price", "last_price", "sess_close", "session_close"):
                val = row.get(key)
                if isinstance(val, (int, float)) and float(val) > 0:
                    return float(val)
        return None


class SpotPoller:
    """Single background thread polling all watched tickers every second."""

    def __init__(self, spot_cache: LockedTTLCache, interval: float = 1.0) -> None:
        self._cache = spot_cache
        self._interval = interval
        self._equity_feed = YFinanceSpotFeed()
        self._futures_feed = CBOEFuturesSpotFeed()
        self._watched: Dict[str, float] = {}
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="spot-poller", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def watch(self, ticker: str) -> None:
        with self._lock:
            if ticker not in self._watched:
                self._watched[ticker] = 0.0

    def _feed_for(self, ticker: str) -> SpotFeed:
        return self._futures_feed if ticker in FUTURES_TICKERS else self._equity_feed

    def _run(self) -> None:
        while not self._stop.wait(self._interval):
            with self._lock:
                tickers = list(self._watched)
            for ticker in tickers:
                try:
                    price = self._feed_for(ticker).fetch(ticker)
                except Exception:
                    price = None
                if price is not None and price > 0:
                    self._cache.set(ticker, price)
                    with self._lock:
                        self._watched[ticker] = time.time()

    def current(self, ticker: str) -> Optional[float]:
        """Return the freshest spot; synchronous fetch on first touch."""
        self.watch(ticker)
        price = self._cache.get(ticker)
        if price is not None:
            return price
        price = self._feed_for(ticker).fetch(ticker)
        if price is not None and price > 0:
            self._cache.set(ticker, price)
        return price


# ---------------------------------------------------------------------------
# Chain anchor (morning OI via yfinance)
# ---------------------------------------------------------------------------

@dataclass
class ChainData:
    ticker: str
    expiry: str
    strikes: np.ndarray
    oi_calls: np.ndarray
    oi_puts: np.ndarray
    vol_calls: np.ndarray
    vol_puts: np.ndarray
    iv: np.ndarray


@dataclass
class ChainEntry:
    data: ChainData
    fetched_ts: float


class YFinanceChainFetcher:
    """Morning-anchor chain fetch (strikes/OI/volume/IV) via yfinance."""

    def __init__(self) -> None:
        from yfinance import Ticker

        self._ticker_cls = Ticker

    def fetch(self, ticker: str) -> Optional[ChainData]:
        try:
            yt = self._ticker_cls(ticker)
            expirations = list(yt.options)
            if not expirations:
                log.warning("No option expirations for %s", ticker)
                return None
            expiry = self._pick_expiry(expirations)
            chain = yt.option_chain(expiry)

            calls = chain.calls[["strike", "openInterest", "volume", "impliedVolatility"]].rename(
                columns={
                    "openInterest": "oi_calls",
                    "volume": "vol_calls",
                    "impliedVolatility": "iv_calls",
                }
            )
            puts = chain.puts[["strike", "openInterest", "volume", "impliedVolatility"]].rename(
                columns={
                    "openInterest": "oi_puts",
                    "volume": "vol_puts",
                    "impliedVolatility": "iv_puts",
                }
            )
            df = pd.merge(calls, puts, on="strike", how="outer").sort_values("strike")
            iv = df[["iv_calls", "iv_puts"]].mean(axis=1, skipna=True)

            return ChainData(
                ticker=ticker,
                expiry=expiry,
                strikes=df["strike"].to_numpy(dtype=np.float64),
                oi_calls=df["oi_calls"].fillna(0.0).to_numpy(dtype=np.float64),
                oi_puts=df["oi_puts"].fillna(0.0).to_numpy(dtype=np.float64),
                vol_calls=df["vol_calls"].fillna(0.0).to_numpy(dtype=np.float64),
                vol_puts=df["vol_puts"].fillna(0.0).to_numpy(dtype=np.float64),
                iv=iv.to_numpy(dtype=np.float64),
            )
        except Exception as exc:
            log.warning("Chain fetch failed for %s: %s", ticker, exc)
            return None

    @staticmethod
    def _pick_expiry(expirations: List[str]) -> str:
        """Nearest expiry at least 2 days out (skips noisy 0DTE); else earliest."""
        today = date.today()
        usable = [e for e in expirations if (date.fromisoformat(e) - today).days >= 2]
        pool = usable or expirations
        return min(pool, key=lambda e: date.fromisoformat(e))


# ---------------------------------------------------------------------------
# Application state & request pipeline
# ---------------------------------------------------------------------------

class LevelFlipApp:
    """Owns every cache, feed, poller, engine and analyst."""

    def __init__(self) -> None:
        self.engine = QuantEngine()
        self.analyst = LLMAnalyst()
        self.spot_cache = LockedTTLCache(maxsize=256, ttl=SPOT_TTL_SECONDS)
        self.chain_cache = LockedTTLCache(maxsize=32, ttl=CHAIN_TTL_SECONDS)
        self.payload_cache = LockedTTLCache(maxsize=256, ttl=PAYLOAD_TTL_SECONDS)
        self.candles_cache = LockedTTLCache(maxsize=32, ttl=CANDLES_TTL_SECONDS)
        self.poller = SpotPoller(self.spot_cache)
        self.chain_fetcher = YFinanceChainFetcher()
        self._chain_locks: Dict[str, threading.Lock] = {}
        self._chain_locks_guard = threading.Lock()
        self.started_at = time.time()

    def _lock_for(self, ticker: str) -> threading.Lock:
        with self._chain_locks_guard:
            lock = self._chain_locks.get(ticker)
            if lock is None:
                lock = self._chain_locks[ticker] = threading.Lock()
            return lock

    def get_chain(self, ticker: str) -> Tuple[Optional[ChainData], bool]:
        """Return (chain, stale_flag). Single-flight refresh; serve stale on failure."""
        entry = self.chain_cache.get(ticker)
        now = time.time()
        if entry is not None and now - entry.fetched_ts < CHAIN_REFRESH_SECONDS:
            return entry.data, now - entry.fetched_ts > CHAIN_STALE_AFTER_SECONDS

        with self._lock_for(ticker):  # single-flight: one refetch at a time
            entry = self.chain_cache.get(ticker)
            if entry is not None and now - entry.fetched_ts < CHAIN_REFRESH_SECONDS:
                return entry.data, now - entry.fetched_ts > CHAIN_STALE_AFTER_SECONDS

            fresh = self.chain_fetcher.fetch(ticker)
            if fresh is not None:
                self.chain_cache.set(ticker, ChainEntry(data=fresh, fetched_ts=time.time()))
                return fresh, False
            if entry is not None:
                log.warning("Chain refresh failed for %s — serving stale anchor", ticker)
                return entry.data, True
        return None, False

    def build_payload(self, ticker: str, include_analysis: bool) -> IOFPayload:
        """Assemble the full LevelFlip payload for one ticker."""
        spot = self.poller.current(ticker)
        if spot is None:
            raise HTTPException(status_code=503, detail=f"spot feed unavailable for {ticker}")

        chain, stale = self.get_chain(ticker)
        if chain is None:
            raise HTTPException(status_code=502, detail=f"no options chain available for {ticker}")

        result = self.engine.compute(
            ticker=ticker,
            spot=spot,
            strikes=chain.strikes,
            oi_calls=chain.oi_calls,
            oi_puts=chain.oi_puts,
            iv=chain.iv,
            vol_calls=chain.vol_calls,
            vol_puts=chain.vol_puts,
            expiry=chain.expiry,
        )
        if result is None:
            raise HTTPException(status_code=503, detail="engine produced no tradeable strikes")

        # Serialization only — the math above is fully vectorized
        profile = [
            GexBar(
                strike=float(s),
                gex=float(g),
                oi_calls=int(round(oc)),
                oi_puts=int(round(op)),
                iv=float(v),
            )
            for s, g, oc, op, v in zip(
                result.strikes.tolist(),
                result.gex.tolist(),
                result.oi_calls.tolist(),
                result.oi_puts.tolist(),
                result.iv.tolist(),
            )
        ]

        analysis = None
        if include_analysis:
            analysis = self.analyst.generate(
                ticker=ticker,
                spot=spot,
                call_wall=result.call_wall,
                put_wall=result.put_wall,
                gamma_flip=result.gamma_flip,
                max_pain=result.max_pain,
                expected_move=result.expected_move,
                net_gex=result.net_gex,
            )

        return IOFPayload(
            ticker=ticker,
            spot_price=float(spot),
            as_of=datetime.now(timezone.utc).isoformat(),
            call_wall=result.call_wall,
            put_wall=result.put_wall,
            gamma_flip=result.gamma_flip,
            max_pain=result.max_pain,
            expected_move=result.expected_move,
            atm_iv=result.atm_iv,
            net_gex=result.net_gex,
            chain_stale=stale,
            gex_profile=profile,
            analysis=analysis,
        )

    def get_candles(
        self, ticker: str, interval: str = "1m", period: str = "1d"
    ) -> CandlesPayload:
        """OHLC candles for the chart canvas (yfinance history, 30s cache).

        Works for equities/ETFs (SPY) and futures (ES=F, NQ=F) — yfinance
        serves price history for both, only options chains are restricted.
        """
        cached = self.candles_cache.get(ticker)
        if cached is not None:
            return cached

        from yfinance import Ticker

        hist = Ticker(ticker).history(period=period, interval=interval, prepost=False)
        if hist.empty:
            raise HTTPException(status_code=502, detail=f"no price history for {ticker}")

        times = (hist.index.astype(np.int64) // 1_000_000_000).tolist()  # epoch seconds
        candles = [
            CandleBar(
                time=int(t),
                open=float(o),
                high=float(h),
                low=float(l),
                close=float(c),
            )
            for t, o, h, l, c in zip(
                times, hist["Open"], hist["High"], hist["Low"], hist["Close"]
            )
        ]
        payload = CandlesPayload(ticker=ticker, interval=interval, candles=candles)
        self.candles_cache.set(ticker, payload)
        return payload


def _warm(state: LevelFlipApp, ticker: str) -> None:
    """Pre-fetch chain + spot in the background so the first client is instant."""
    try:
        state.get_chain(ticker)
        state.poller.current(ticker)
        log.info("Warm-up complete for %s", ticker)
    except Exception as exc:  # warm-up must never take the process down
        log.warning("Warm-up failed for %s: %s", ticker, exc)


# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------

def create_app() -> FastAPI:
    state = LevelFlipApp()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        state.poller.start()
        default_ticker = (os.getenv("DEFAULT_TICKER") or DEFAULT_TICKER).upper()
        if _TICKER_PATTERN.match(default_ticker):
            threading.Thread(
                target=_warm, args=(state, default_ticker), name="levelflip-warm", daemon=True
            ).start()
        log.info("LevelFlip API online")
        yield
        state.poller.stop()

    app = FastAPI(
        title="LevelFlip Terminal API",
        version="1.0.0",
        description="Institutional dealer positioning / GEX microservice (hybrid OI anchor + live spot)",
        lifespan=lifespan,
    )

    origins = [
        o.strip()
        for o in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",")
        if o.strip()
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/", include_in_schema=False)
    def root() -> Dict[str, str]:
        return {"service": "LevelFlip API", "docs": "/docs", "iof": "/api/v1/iof?ticker=SPY"}

    @app.get("/health")
    def health() -> Dict[str, Any]:
        return {
            "status": "ok",
            "uptime_seconds": round(time.time() - state.started_at, 1),
            "payload_cache_ttl": PAYLOAD_TTL_SECONDS,
            "watched_tickers": sorted(list(state.poller._watched)),  # noqa: SLF001
        }

    @app.get("/api/v1/iof", response_model=IOFPayload)
    def iof(
        ticker: str = Query(
            default=DEFAULT_TICKER,
            description="Equity/ETF (SPY, QQQ, NVDA) or futures (ES, NQ, YM, RTY)",
        ),
        include_analysis: bool = Query(
            default=True,
            description="Attach the AI desk briefing (5-min per-ticker cache)",
        ),
    ) -> IOFPayload:
        symbol = ticker.strip().upper()
        if not _TICKER_PATTERN.match(symbol):
            raise HTTPException(status_code=400, detail=f"invalid ticker: {ticker!r}")

        cache_key = f"{symbol}:{1 if include_analysis else 0}"
        cached = state.payload_cache.get(cache_key)
        if cached is not None:
            return cached

        payload = state.build_payload(symbol, include_analysis)
        state.payload_cache.set(cache_key, payload)
        return payload

    @app.get("/api/v1/candles", response_model=CandlesPayload)
    def candles(
        ticker: str = Query(default=DEFAULT_TICKER, description="Equity/ETF or futures (ES, NQ)"),
        interval: str = Query(default="1m", description="Bar size"),
        period: str = Query(default="1d", description="Lookback window"),
    ) -> CandlesPayload:
        symbol = ticker.strip().upper()
        if not _TICKER_PATTERN.match(symbol):
            raise HTTPException(status_code=400, detail=f"invalid ticker: {ticker!r}")
        if interval not in {"1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d"}:
            raise HTTPException(status_code=400, detail=f"invalid interval: {interval!r}")
        if period not in {"1d", "5d", "1mo", "3mo", "6mo", "1y"}:
            raise HTTPException(status_code=400, detail=f"invalid period: {period!r}")
        return state.get_candles(symbol, interval, period)

    return app


app = create_app()

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        log_level="info",
    )
