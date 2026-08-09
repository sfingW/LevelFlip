# LevelFlip ⚡

Institutional dealer-positioning terminal: live **dollar Gamma Exposure (GEX)**, Call Wall / Put Wall, Zero-Gamma (LevelFlip) pivot, **Max Pain** and **Expected Move** — built on a zero-cost hybrid data pipeline, per the IOF Derivation Masterclass methodology.

## Architecture

```
┌─────────────┐  yfinance (09:30 ET anchor)   ┌──────────────────┐
│  OCC Chain  │ ────────────────────────────► │  quant_engine.py │
│  OI / Vol / │                               │  vectorized BS Γ  │
│  IV (cached)│                               └────────┬─────────┘
└─────────────┘                                        │ GEX / walls / flip /
┌─────────────┐  1s spot poller                       │ max pain / EM / ATM IV
│  Spot feed  │ ───────────────────────────►  FastAPI (TTLCache 2s)
│ yfinance /  │                                /api/v1/iof?ticker=SPY
│ CBOE futures│                                /api/v1/candles
└─────────────┘                                └────────┬─────────┘
┌─────────────┐  Groq → Gemini → static                │
│ LLM Analyst │ ─────────────────────────────►  Next.js 15 terminal
└─────────────┘                                (SWR 2s · custom SVG, no chart lib)
```

- **Anchor:** options chain (strikes/OI/volume/IV) fetched from yfinance, cached in `cachetools.TTLCache`, lazily re-anchored.
- **Catalyst:** 1-second spot polling — yfinance fast-info for equities/ETFs (SPY, QQQ, NVDA), CBOE public delayed JSON for futures (ES, NQ, YM, RTY).
- **Math (fully vectorized, NumPy/SciPy, zero Python loops):**
  - **Dollar GEX** (masterclass form): `GEX = Γ · (OIc − OIp) · S² · 0.01 · 100` — walls from cumulative-GEX extremes, zero-gamma flip via nearest-crossing interpolation.
  - **Max Pain:** `L(K) = Σ OIc·(K−Kj) + Σ OIp·(Kj−K)`, argmin over the grid — vectorized with cumulative sums.
  - **Expected Move:** `EM = S · σ_ATM · √(DTE/365)` from the ATM IV.
- **AI brief:** provider-agnostic desk briefing (Groq primary, Gemini fallback, static rule-based last) with a deterministic spot-vs-pivot truth guard, enriched with Max Pain & Expected Move context. 5-minute per-ticker cache.
- **Zero external databases.** All state is in-memory TTLCache.

## Quickstart

### Backend

```powershell
cd backend
pip install -r requirements.txt
# copy keys into backend/.env (GROQ_API_KEY / GEMINI_API_KEY / DEEPSEEK_API_KEY)
python main.py          # → http://localhost:8000/docs
```

### Frontend

```powershell
cd frontend
npm install
npm run dev             # → http://localhost:3000
```

Override the API origin with `NEXT_PUBLIC_API_URL` if the backend isn't on `localhost:8000`.

## API contract

`GET /api/v1/iof?ticker=SPY&include_analysis=true`

```json
{
  "ticker": "SPY",
  "spot_price": 542.05,
  "as_of": "2026-08-09T13:31:00.000Z",
  "call_wall": 545.00,
  "put_wall": 538.00,
  "gamma_flip": 541.50,
  "max_pain": 542.00,
  "expected_move": 4.32,
  "atm_iv": 0.1781,
  "net_gex": 123456789.12,
  "chain_stale": false,
  "gex_profile": [
    { "strike": 540.0, "gex": -9876543.2, "oi_calls": 1240, "oi_puts": 18920, "iv": 0.1781 }
  ],
  "analysis": { "signal": "BULLISH_DRIFT", "summary": "…", "provider": "groq", "generated_at": "…" }
}
```

`GET /api/v1/candles?ticker=SPY&interval=1m&period=1d` → OHLC bar array (kept for clients; the terminal renders its own SVG).

## Design language

Dark terminal (`#0B0E14` canvas), glass cards, ambient glow field + film grain, Inter + JetBrains Mono (next/font). One screen, one truth:
- **IOF Battle Map** — hand-built SVG (no chart lib): GEX histogram by strike around the zero line, ±1σ expected-move band, structural hairlines (Call Wall / LevelFlip / Max Pain / Put Wall), pulsing live spot, right-rail key, dealer-regime banner.
- **Stat strip** — Net / Call / Put GEX, Max Pain, 1σ Move, ATM IV at a glance.
- **Tactical ladder** — masterclass Module 4 execution matrix: per-level dealer mechanic + the one trade that works there.
- **AI desk brief** — signal badge + one-sentence read, provider-stamped.
- Custom SVG glyphs only (no default emojis): Call Wall `#EF4444` · Put Wall `#22C55E` · LevelFlip `#F59E0B` · Max Pain `#A78BFA` · 1σ `#38BDF8`.

Regime badge (LONG GAMMA ⇄ SHORT GAMMA) is deterministic; ⚡ SHARE SETUP copies a dark-mode-ready setup to the clipboard.

## Disclaimer

Educational/experimental. Options data is end-of-day/delayed; not investment advice.
