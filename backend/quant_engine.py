"""
LevelFlip Quant Engine
======================

Vectorized Black-Scholes Gamma / Gamma-Exposure engine.

Clean-room reimplementation (clean of GPL/unlicensed sources) of the
vectorized GEX approach used by zrack/gex-terminal (MIT) and
erma0x/gexxer (Apache-2.0). Formulas follow market convention:

    GEX_k = Gamma_k * (OI_call,k - OI_put,k) * S^2 * 0.01 * 100

  - Gamma_k : Black-Scholes gamma at strike k (identical for call & put)
  - OI      : open interest with dealer convention — puts counted negative
              (dealers are structurally long the put hedge, short the call)
  - S^2     : dollar-GEX form — S^2 = S * S converts share-gamma to dollar
              exposure per 1% move (IOF Masterclass Module 2). Positive
              scaling, so walls / gamma-flip are unaffected vs share-GEX.
  - 0.01    : 1% spot move convention (SPX/SPY GEX reporting)
  - 100     : equity/index contract multiplier

All heavy math is single-pass NumPy over the full strike grid. No
Python-level iteration over option contracts — sub-10ms for a typical
~400-strike chain. The engine consumes the top 4 front-month expirations
and merges them into ONE unified dollar-GEX matrix: each expiry's gamma is
priced with its own exact fractional-year DTE, every per-expiry series is
reindexed onto the union strike grid, and the contributions are summed.

Outputs:
  - call_wall   : strike of peak positive CALL dollar GEX (short-gamma
                  resistance) — dollar-GEX peak, not raw contract count
  - put_wall    : strike of peak negative PUT dollar GEX (structural
                  long-gamma support)
  - gamma_flip  : zero-gamma "LevelFlip" pivot — linear interpolation of
                  the cumulative-GEX zero crossing, nearest crossing to
                  spot when several exist
  - max_pain    : strike minimizing total buyer payout at expiry (OPEX pin
                  magnet) — vectorized via cumulative-sum decomposition
  - expected_move : 1σ move container S * σ_ATM * sqrt(T) (68% band)
  - atm_iv      : ATM implied vol (strike nearest spot, cross-expiry mean)
  - regime      : LONG_GAMMA / SHORT_GAMMA from total net GEX sign (keeps
                  UI badges synchronized with total market exposure)
  - gex_profile : per-strike net GEX array (serialized in the API layer)
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime
from threading import RLock
from typing import Optional, Sequence, Tuple

import numpy as np
from cachetools import TTLCache
from scipy import stats

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CONTRACT_MULTIPLIER = 100.0    # equity/index contract multiplier
MOVE_SIZE = 0.01               # 1% move — standard GEX reporting unit
DEFAULT_RISK_FREE = 0.0425     # risk-free proxy (SOFR ~4.25%, 2026)
MIN_TAU_YEARS = 1.0 / 365.0    # floor for same-day expiry (avoids div-by-0)
FALLBACK_IV = 0.20             # used when a strike has no quoted IV
IV_FLOOR = 0.05

# Weighted "wall strength" heuristic from the original spec:
#   wall_score = OI * 0.3 + Volume * 0.7
OI_WEIGHT = 0.3
VOLUME_WEIGHT = 0.7


# ---------------------------------------------------------------------------
# Core vectorized math
# ---------------------------------------------------------------------------

@dataclass
class ExpiryChain:
    """One expiration's option chain — the engine's multi-expiry input unit.

    `expiry` is the ISO date string; the engine derives that expiry's exact
    fractional-year DTE from it (no hardcoded time-to-expiry anywhere).
    """

    expiry: Optional[str]
    strikes: np.ndarray
    oi_calls: np.ndarray
    oi_puts: np.ndarray
    iv: Optional[np.ndarray] = None
    vol_calls: Optional[np.ndarray] = None
    vol_puts: Optional[np.ndarray] = None


def _tau_years(expiry: Optional[str], ref: Optional[date] = None) -> float:
    """Days to expiry in years, floored to a 1-day minimum."""
    if not expiry:
        return MIN_TAU_YEARS
    try:
        exp_date = date.fromisoformat(str(expiry)[:10])
    except ValueError:
        return MIN_TAU_YEARS
    today = ref or date.today()
    days = (exp_date - today).days
    return max(MIN_TAU_YEARS, days / 365.0)


def black_scholes_greeks(
    spot: float,
    strikes: np.ndarray,
    tau: float,
    sigma: np.ndarray,
    r: float = DEFAULT_RISK_FREE,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Vectorized Black-Scholes (delta_call, delta_put, gamma) over a strike grid.

    IV sanitation is handled here so the grid never produces NaNs: entries
    that are non-finite or non-positive are replaced with the median valid
    IV (or the fallback IV if none are valid).
    """
    S = float(spot)
    K = np.asarray(strikes, dtype=np.float64)
    tau = max(float(tau), MIN_TAU_YEARS)
    sig = np.asarray(sigma, dtype=np.float64)
    r = float(r)

    valid_iv = np.isfinite(sig) & (sig > 0.0)
    if valid_iv.any():
        fallback = float(np.median(sig[valid_iv])) or FALLBACK_IV
    else:
        fallback = FALLBACK_IV
    sig = np.where(valid_iv, sig, fallback)
    sig = np.clip(sig, IV_FLOOR, None)

    sqrt_tau = math.sqrt(tau)
    with np.errstate(divide="ignore", invalid="ignore"):
        vol_t = sig * sqrt_tau
        d1 = (np.log(S / K) + (r + 0.5 * sig * sig) * tau) / vol_t
        d2 = d1 - vol_t

    phi_d1 = stats.norm.pdf(d1)
    delta_call = stats.norm.cdf(d1)
    delta_put = delta_call - 1.0
    gamma = phi_d1 / (S * vol_t)

    # Pin any non-finite greek artefacts (e.g. degenerate strikes) to safe values
    gamma = np.where(np.isfinite(gamma), gamma, 0.0)
    delta_call = np.where(np.isfinite(delta_call), delta_call, 0.0)
    delta_put = np.where(np.isfinite(delta_put), delta_put, -1.0)

    return delta_call, delta_put, gamma


def _gamma_flip(
    strikes: np.ndarray,
    cum_gex: np.ndarray,
    spot: float,
) -> float:
    """Zero-gamma 'LevelFlip' pivot from the cumulative net-GEX curve.

    `strikes` must be sorted ascending. The zero crossing uses interpolation
    between the two bracketing strikes of each sign change (cumGEX is not
    monotonic, so np.interp cannot be used directly); when several crossings
    exist the one nearest spot wins.
    """
    signs = np.sign(cum_gex)
    crossing_idxs = np.flatnonzero(signs[:-1] != signs[1:])
    if crossing_idxs.size:
        nearest = crossing_idxs[int(np.argmin(np.abs(strikes[crossing_idxs] - spot)))]
        k0, k1 = float(strikes[nearest]), float(strikes[nearest + 1])
        g0, g1 = float(cum_gex[nearest]), float(cum_gex[nearest + 1])
        return k0 + (0.0 - g0) * (k1 - k0) / (g1 - g0) if g1 != g0 else k0
    return float(strikes[int(np.argmin(np.abs(cum_gex)))])


def _max_pain_strike(
    strikes: np.ndarray,
    oi_calls: np.ndarray,
    oi_puts: np.ndarray,
) -> float:
    """Max Pain strike — minimizes total option-buyer payout at expiry:

        L(K_i) = Σ_{K_j<K_i} OIc_j·(K_i−K_j) + Σ_{K_j>K_i} OIp_j·(K_j−K_i)

    Each sum decomposes into K·ΣOI − Σ(OI·K), so both tails collapse to
    cumulative sums — fully vectorized, no per-strike Python loop.
    """
    K = strikes
    # calls below the candidate strike: K_i·ΣOIc_lt − Σ(OIc_lt·K)
    c_lt = np.cumsum(oi_calls) - oi_calls
    s_lt = np.cumsum(oi_calls * K) - oi_calls * K
    call_loss = K * c_lt - s_lt
    # puts above the candidate strike: Σ(OIp_gt·K) − K_i·ΣOIp_gt
    c_gt = np.cumsum(oi_puts[::-1])[::-1] - oi_puts
    s_gt = np.cumsum((oi_puts * K)[::-1])[::-1] - oi_puts * K
    put_loss = s_gt - K * c_gt

    loss = call_loss + put_loss
    return float(K[int(np.argmin(loss))])


def _atm_iv_and_move(
    spot: float,
    tau: float,
    iv: np.ndarray,
    strikes: np.ndarray,
) -> Tuple[float, float]:
    """ATM IV (strike nearest spot) and the 1σ expected move S·σ_ATM·√T."""
    atm_idx = int(np.argmin(np.abs(strikes - spot)))
    atm_iv = float(iv[atm_idx])
    expected_move = spot * atm_iv * math.sqrt(max(tau, MIN_TAU_YEARS))
    return atm_iv, expected_move


# ---------------------------------------------------------------------------
# Output container
# ---------------------------------------------------------------------------

@dataclass
class GexResult:
    """Output of one engine pass over the unified multi-expiry grid."""

    ticker: str
    expiry: Optional[str]
    spot: float
    strikes: np.ndarray
    oi_calls: np.ndarray
    oi_puts: np.ndarray
    iv: np.ndarray
    gex: np.ndarray
    cum_gex: np.ndarray
    wall_score_calls: np.ndarray
    wall_score_puts: np.ndarray
    call_wall: float
    put_wall: float
    gamma_flip: float
    max_pain: float
    expected_move: float
    atm_iv: float
    net_gex: float
    regime: str


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

class QuantEngine:
    """Vectorized multi-expiry GEX computation over anchored option chains."""

    def compute(
        self,
        ticker: str,
        spot: float,
        expiries: Sequence[ExpiryChain],
        r: float = DEFAULT_RISK_FREE,
    ) -> Optional[GexResult]:
        """Compute the unified multi-expiry dollar-GEX matrix.

        `expiries` holds the top front-month chains (front first; typically 4).
        Each expiry's gamma is priced with its own exact fractional-year DTE
        — the same strike in different months gets different gamma, which raw
        Open-Interest math cannot see. Every per-expiry series is reindexed
        onto the union strike grid and summed into one matrix.

        Walls are peak dollar-GEX strikes (call wall = max call GEX, put wall
        = most-negative put GEX) — not raw contract counts. Regime comes from
        total net GEX so UI badges mirror total market exposure.

        All contract-level math is vectorized; the only iteration is over the
        fixed (<=4) expiry count, never over contracts.
        """
        if spot is None or not np.isfinite(spot) or spot <= 0.0:
            return None

        per_expiry: list = []  # cleaned, sorted, greeks applied per expiry
        for ec in expiries:
            strikes = np.asarray(ec.strikes, dtype=np.float64)
            oi_calls = np.asarray(ec.oi_calls, dtype=np.float64)
            oi_puts = np.asarray(ec.oi_puts, dtype=np.float64)
            if strikes.size == 0:
                continue

            # Mask out garbage rows: non-positive strike, or zero OI on both sides
            oi_calls = np.where(np.isfinite(oi_calls), oi_calls, 0.0)
            oi_puts = np.where(np.isfinite(oi_puts), oi_puts, 0.0)
            keep = (
                np.isfinite(strikes)
                & (strikes > 0.0)
                & ((oi_calls > 0.0) | (oi_puts > 0.0))
            )
            if not keep.any():
                continue

            strikes = strikes[keep]
            oi_calls = oi_calls[keep]
            oi_puts = oi_puts[keep]
            iv = (
                np.asarray(ec.iv, dtype=np.float64)[keep]
                if ec.iv is not None
                else np.full(strikes.size, FALLBACK_IV)
            )
            vol_calls = (
                np.asarray(ec.vol_calls, dtype=np.float64)[keep]
                if ec.vol_calls is not None
                else np.zeros_like(oi_calls)
            )
            vol_puts = (
                np.asarray(ec.vol_puts, dtype=np.float64)[keep]
                if ec.vol_puts is not None
                else np.zeros_like(oi_puts)
            )

            # Ascending strike order — cumulative-GEX logic requires it
            order = np.argsort(strikes, kind="stable")
            strikes = strikes[order]
            oi_calls = oi_calls[order]
            oi_puts = oi_puts[order]
            iv = iv[order]
            vol_calls = vol_calls[order]
            vol_puts = vol_puts[order]

            # Exact fractional-year DTE for THIS expiry (no hardcoded T)
            tau = _tau_years(ec.expiry)
            _, _, gamma = black_scholes_greeks(spot, strikes, tau, iv, r)

            # Dollar-GEX scale — S^2 (IOF Masterclass M2); positive so
            # walls / flip are unaffected by units
            scale = spot * spot * MOVE_SIZE * CONTRACT_MULTIPLIER
            per_expiry.append(
                (
                    strikes,
                    oi_calls,
                    oi_puts,
                    iv,
                    vol_calls,
                    vol_puts,
                    gamma * oi_calls * scale,   # call-side dollar GEX
                    gamma * oi_puts * scale,    # put-side dollar GEX (magnitude)
                )
            )

        if not per_expiry:
            return None

        # Union strike axis across all expiries; every expiry's strikes are
        # a subset of it, so searchsorted gives exact positions
        grid = np.unique(np.concatenate([g[0] for g in per_expiry]))
        n = grid.size
        pos = [np.searchsorted(grid, g[0]) for g in per_expiry]

        oi_calls = np.zeros(n)
        oi_puts = np.zeros(n)
        vol_calls = np.zeros(n)
        vol_puts = np.zeros(n)
        gex_calls = np.zeros(n)
        gex_puts = np.zeros(n)
        iv_mat = np.full((len(per_expiry), n), np.nan)

        for i, g in enumerate(per_expiry):
            p = pos[i]
            oi_calls[p] += g[1]
            oi_puts[p] += g[2]
            iv_mat[i, p] = g[3]
            vol_calls[p] += g[4]
            vol_puts[p] += g[5]
            gex_calls[p] += g[6]
            gex_puts[p] += g[7]

        # Cross-expiry mean IV per strike (missing months -> NaN, ignored)
        iv = np.nanmean(iv_mat, axis=0)
        iv = np.where(np.isfinite(iv) & (iv > 0.0), iv, FALLBACK_IV)

        gex = gex_calls - gex_puts
        cum_gex = np.cumsum(gex)

        # Walls = peak dollar-GEX strikes (not raw contract counts):
        #   call wall -> strike of max call dollar GEX
        #   put wall  -> strike of most-negative put dollar GEX
        call_wall = float(grid[int(np.argmax(gex_calls))])
        put_wall = float(grid[int(np.argmin(-gex_puts))])
        gamma_flip = _gamma_flip(grid, cum_gex, spot)

        # Max Pain + 1σ expected move (paper M2 §4-§5) — vectorized, on the
        # combined book; EM horizon = front month (dominant hedging window)
        max_pain = _max_pain_strike(grid, oi_calls, oi_puts)
        front_tau = _tau_years(expiries[0].expiry)
        atm_iv, expected_move = _atm_iv_and_move(spot, front_tau, iv, grid)

        # Weighted wall-strength heuristic (OI*0.3 + Volume*0.7), vectorized
        wall_score_calls = oi_calls * OI_WEIGHT + vol_calls * VOLUME_WEIGHT
        wall_score_puts = oi_puts * OI_WEIGHT + vol_puts * VOLUME_WEIGHT

        net_gex_total = float(gex.sum())
        regime = "LONG_GAMMA" if net_gex_total >= 0.0 else "SHORT_GAMMA"

        return GexResult(
            ticker=ticker,
            expiry=expiries[0].expiry,
            spot=float(spot),
            strikes=grid,
            oi_calls=oi_calls,
            oi_puts=oi_puts,
            iv=iv,
            gex=gex,
            cum_gex=cum_gex,
            wall_score_calls=wall_score_calls,
            wall_score_puts=wall_score_puts,
            call_wall=call_wall,
            put_wall=put_wall,
            gamma_flip=gamma_flip,
            max_pain=max_pain,
            expected_move=expected_move,
            atm_iv=atm_iv,
            net_gex=net_gex_total,
            regime=regime,
        )


# ---------------------------------------------------------------------------
# Thread-safe cachetools wrapper (shared by the API and the LLM analyst)
# ---------------------------------------------------------------------------

class LockedTTLCache:
    """Thread-safe cachetools.TTLCache wrapper.

    cachetools TTLCache is not thread-safe; FastAPI threadpools plus the
    background spot poller touch these caches concurrently, so every access
    is serialized through an RLock. Expired entries are treated as missing
    (cachetools semantics) — callers get the default instead of an error.
    """

    def __init__(self, maxsize: int, ttl: float) -> None:
        self._cache = TTLCache(maxsize=maxsize, ttl=ttl)
        self._lock = RLock()

    def get(self, key, default=None):
        with self._lock:
            return self._cache.get(key, default)

    def set(self, key, value) -> None:
        with self._lock:
            self._cache[key] = value

    def pop(self, key, default=None):
        with self._lock:
            return self._cache.pop(key, default)
