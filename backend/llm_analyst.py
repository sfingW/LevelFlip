"""
LevelFlip AI Market Analyst
===========================

Provider-agnostic desk-briefing module. Speaks the OpenAI chat-completions
protocol, which Groq, Gemini (OpenAI-compat layer) and DeepSeek all expose,
so swapping providers is a pure environment-variable change:

    LLM_PROVIDER=groq      GROQ_API_KEY=...      (default primary)
    LLM_PROVIDER=gemini    GEMINI_API_KEY=...    (fallback)
    LLM_PROVIDER=deepseek  DEEPSEEK_API_KEY=...

Fallback ladder: configured provider -> groq -> gemini -> static rule-based
briefing. If no API key is configured the module degrades to the static
analyst (provider="static") and never blocks the terminal.

Responses are cached per ticker with a 5-minute TTL, so 500+ concurrent
users share a single LLM call per ticker per window — $0 infrastructure.
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pydantic import BaseModel

from quant_engine import LockedTTLCache

log = logging.getLogger("levelflip")

try:
    from openai import OpenAI
    _HAS_OPENAI = True
except ImportError:  # pragma: no cover — graceful degradation without the package
    _HAS_OPENAI = False

ANALYSIS_CACHE_TTL_SECONDS = 5 * 60   # 5-minute per-ticker analysis cache
ANALYSIS_CACHE_MAXSIZE = 1024

LLM_TIMEOUT_SECONDS = 12.0
LLM_TEMPERATURE = 0.2
LLM_MAX_TOKENS = 300

VALID_SIGNALS = {
    "BULLISH_ABSORPTION", "BEARISH_ABSORPTION",
    "BULLISH_DRIFT", "BEARISH_PRESSURE",
    "CALL_WALL_RESISTANCE", "PUT_WALL_SUPPORT",
    "PINNED", "NEUTRAL",
}

# provider -> (OpenAI-compatible base_url, default model, env key name)
# Note: gemini-1.5-flash and gemini-2.5-flash are retired for new API users
# (404); 3.6-flash is the current stable flash line. Override any default
# via the LLM_MODEL env var.
PROVIDERS: Dict[str, tuple] = {
    "groq": ("https://api.groq.com/openai/v1", "llama-3.3-70b-versatile", "GROQ_API_KEY"),
    "gemini": ("https://generativelanguage.googleapis.com/v1beta/openai/", "gemini-3.6-flash", "GEMINI_API_KEY"),
    "deepseek": ("https://api.deepseek.com/v1", "deepseek-chat", "DEEPSEEK_API_KEY"),
}

DEFAULT_PRIMARY = "groq"
DEFAULT_FALLBACKS: List[str] = ["groq", "gemini"]

# Signal families tied to the deterministic spot-vs-pivot relation. The
# LLM's signal is cross-checked against these before it reaches the desk —
# a contradiction is treated as a failed provider (static fallback).
LONG_REGIME_SIGNALS = {"BULLISH_ABSORPTION", "BULLISH_DRIFT", "CALL_WALL_RESISTANCE"}
SHORT_REGIME_SIGNALS = {"BEARISH_ABSORPTION", "BEARISH_PRESSURE", "PUT_WALL_SUPPORT"}


class AnalystNote(BaseModel):
    """Desk briefing attached to the LevelFlip payload."""

    signal: str
    summary: str
    provider: str
    generated_at: str


ANALYST_PROMPT = """You are the LevelFlip AI Market Analyst — an institutional options-microstructure desk brief.
You are given one dealer-positioning snapshot. Produce a terse, desk-ready briefing.

DATA:
- Ticker: {ticker}
- Spot: {spot}
- Call Wall (short-gamma resistance): {call_wall}
- Put Wall (long-gamma support): {put_wall}
- LevelFlip / Zero-Gamma pivot: {gamma_flip}
- Max Pain (OPEX pin magnet): {max_pain}
- Expected Move (1σ band, ±): {expected_move}
- Net GEX: {net_gex}

GROUND-TRUTH REGIME (computed by the system — do NOT re-derive, NEVER contradict):
- Relation: {relation}
- Your signal MUST be one of: {family}
- Your summary MUST describe spot as trading {direction} the pivot. The opposite is an error.
- If you cannot write a summary consistent with the relation, signal MUST be NEUTRAL.

RULES:
1. signal MUST be exactly one of: BULLISH_ABSORPTION, BEARISH_ABSORPTION, BULLISH_DRIFT,
   BEARISH_PRESSURE, CALL_WALL_RESISTANCE, PUT_WALL_SUPPORT, PINNED, NEUTRAL.
2. summary: 2-3 sentences, desk tone, numbers only from the data above, no boilerplate disclaimers.

Reply with ONLY a JSON object: {{"signal": "...", "summary": "..."}}"""


def _regime_context(spot: float, gamma_flip: float):
    """Precompute the spot-vs-pivot regime so the LLM never derives it."""
    if spot > gamma_flip:
        return (
            f"spot {spot:,.2f} is ABOVE pivot {gamma_flip:,.2f} — LONG gamma regime",
            "BULLISH_ABSORPTION, BULLISH_DRIFT, CALL_WALL_RESISTANCE",
            "above",
        )
    return (
        f"spot {spot:,.2f} is BELOW pivot {gamma_flip:,.2f} — SHORT gamma regime",
        "BEARISH_ABSORPTION, BEARISH_PRESSURE, PUT_WALL_SUPPORT",
        "below",
    )


class LLMAnalyst:
    """Multi-provider market briefing generator with per-ticker TTL caching."""

    def __init__(self) -> None:
        self._cache = LockedTTLCache(
            maxsize=ANALYSIS_CACHE_MAXSIZE, ttl=ANALYSIS_CACHE_TTL_SECONDS
        )

    # -- public API -------------------------------------------------------

    def generate(
        self,
        ticker: str,
        spot: float,
        call_wall: float,
        put_wall: float,
        gamma_flip: float,
        max_pain: float,
        expected_move: float,
        net_gex: float,
    ) -> AnalystNote:
        """Return a cached briefing, or synthesize one (live -> static)."""
        cached = self._cache.get(ticker)
        if cached is not None:
            return cached

        note = self._generate_live(
            ticker, spot, call_wall, put_wall, gamma_flip, max_pain, expected_move, net_gex
        )
        if note is None:
            note = self._generate_static(
                ticker, spot, call_wall, put_wall, gamma_flip, max_pain, expected_move, net_gex
            )

        self._cache.set(ticker, note)
        return note

    # -- live path --------------------------------------------------------

    def _provider_chain(self) -> List[str]:
        env_provider = (os.getenv("LLM_PROVIDER") or DEFAULT_PRIMARY).strip().lower()
        chain = list(dict.fromkeys([env_provider] + DEFAULT_FALLBACKS))  # dedupe, keep order
        return [p for p in chain if p in PROVIDERS]

    def _generate_live(
        self,
        ticker: str,
        spot: float,
        call_wall: float,
        put_wall: float,
        gamma_flip: float,
        max_pain: float,
        expected_move: float,
        net_gex: float,
    ) -> Optional[AnalystNote]:
        if not _HAS_OPENAI:
            return None

        relation, family, direction = _regime_context(spot, gamma_flip)
        prompt = ANALYST_PROMPT.format(
            ticker=ticker,
            spot=f"{spot:,.2f}",
            call_wall=f"{call_wall:,.2f}",
            put_wall=f"{put_wall:,.2f}",
            gamma_flip=f"{gamma_flip:,.2f}",
            max_pain=f"{max_pain:,.2f}",
            expected_move=f"{expected_move:,.2f}",
            net_gex=f"{net_gex:,.0f}",
            relation=relation,
            family=family,
            direction=direction,
        )

        for provider in self._provider_chain():
            base_url, model, env_key = PROVIDERS[provider]
            api_key = os.getenv(env_key)
            if not api_key:
                continue
            model = os.getenv("LLM_MODEL", model)
            try:
                client = OpenAI(api_key=api_key, base_url=base_url, timeout=LLM_TIMEOUT_SECONDS)
                resp = client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": "You are a precise options-desk quant."},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=LLM_TEMPERATURE,
                    max_tokens=LLM_MAX_TOKENS,
                )
                content = resp.choices[0].message.content or ""
                parsed = self._parse_json(content)
                if parsed is not None:
                    if self._signal_matches_regime(parsed["signal"], spot, gamma_flip):
                        return AnalystNote(
                            signal=parsed["signal"],
                            summary=parsed["summary"],
                            provider=provider,
                            generated_at=datetime.now(timezone.utc).isoformat(),
                        )
                    log.warning(
                        "LLM signal %s contradicts spot/flip relation (spot=%s flip=%s) — "
                        "treating provider %s as failed",
                        parsed["signal"], spot, gamma_flip, provider,
                    )
            except Exception:
                # any provider failure -> next rung of the ladder
                continue
        return None

    @staticmethod
    def _signal_matches_regime(signal: str, spot: float, gamma_flip: float) -> bool:
        """Deterministic cross-check: does the signal agree with spot vs pivot?"""
        if signal == "PINNED":
            return True
        above_pivot = spot > gamma_flip
        family = LONG_REGIME_SIGNALS if above_pivot else SHORT_REGIME_SIGNALS
        return signal in family

    @staticmethod
    def _parse_json(content: str) -> Optional[Dict[str, str]]:
        """Extract and validate the LLM's JSON reply (tolerates code fences)."""
        text = content.strip()
        fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
        if fence:
            text = fence.group(1).strip()
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", text, re.DOTALL)
            if not match:
                return None
            try:
                payload = json.loads(match.group(0))
            except json.JSONDecodeError:
                return None
        if not isinstance(payload, dict):
            return None
        signal = str(payload.get("signal", "")).strip().upper()
        summary = str(payload.get("summary", "")).strip()
        if signal not in VALID_SIGNALS or not summary:
            return None
        return {"signal": signal, "summary": summary}

    # -- static fallback (deterministic, zero-key) -------------------------

    @staticmethod
    def _generate_static(
        ticker: str,
        spot: float,
        call_wall: float,
        put_wall: float,
        gamma_flip: float,
        max_pain: float,
        expected_move: float,
        net_gex: float,
    ) -> AnalystNote:
        band = max(abs(spot) * 0.001, 0.05)  # 0.1% pin band around the pivot

        if spot >= call_wall:
            signal = "CALL_WALL_RESISTANCE"
            summary = (
                f"{ticker} is trading at/above the call wall ({call_wall:,.2f}); dealers sit "
                "short gamma into this zone — expect supply pressure and sharper downside "
                "if the wall rejects."
            )
        elif spot <= put_wall:
            signal = "PUT_WALL_SUPPORT"
            summary = (
                f"{ticker} sits on the put wall ({put_wall:,.2f}); structural long-gamma "
                "bid should dampen downside below this level."
            )
        elif abs(spot - gamma_flip) <= band:
            signal = "PINNED"
            summary = (
                f"{ticker} is pinned on the zero-gamma pivot ({gamma_flip:,.2f}); dealers are "
                "delta-neutral here — watch for an explosive break in either direction."
            )
        elif spot > gamma_flip:
            signal = "BULLISH_DRIFT"
            summary = (
                f"{ticker} trades above zero gamma ({gamma_flip:,.2f}) toward the call wall "
                f"({call_wall:,.2f}); positive dealer gamma should absorb intraday dips."
            )
        else:
            signal = "BEARISH_PRESSURE"
            summary = (
                f"{ticker} trades below zero gamma ({gamma_flip:,.2f}) toward the put wall "
                f"({put_wall:,.2f}); negative dealer gamma leaves the market exposed to "
                "volatility expansion."
            )

        return AnalystNote(
            signal=signal,
            summary=summary,
            provider="static",
            generated_at=datetime.now(timezone.utc).isoformat(),
        )
