# LevelFlip ⚡

Institutional dealer-positioning terminal: live **Gamma Exposure (GEX)**, Call Wall, Put Wall, and Zero-Gamma (LevelFlip) pivot — built on a zero-cost hybrid data pipeline.

## Architecture

```
┌─────────────┐  yfinance (09:30 ET anchor)   ┌──────────────────┐
│  OCC Chain  │ ────────────────────────────► │  quant_engine.py │
│  OI / Vol / │                               │  vectorized BS Γ  │
│  IV (cached)│                               └────────┬─────────┘
└─────────────┘                                        │ GEX / walls / flip
┌─────────────┐  1s spot poller                       ▼
│  Spot feed  │ ───────────────────────────►  FastAPI (TTLCache 2s)
│ yfinance /  │                                /api/v1/iof?ticker=SPY
│ CBOE futures│                                /api/v1/candles
└─────────────┘                                └────────┬─────────┘
┌─────────────┐  Groq → Gemini → static                │
│ LLM Analyst │ ─────────────────────────────►  Next.js 14 bento UI
└─────────────┘                                (SWR 2s · lightweight-charts · recharts)
```

- **Anchor:** options chain (strikes/OI/volume/IV) fetched from yfinance, cached in `cachetools.TTLCache`, lazily re-anchored.
- **Catalyst:** 1-second spot polling — yfinance fast-info for equities/ETFs (SPY, QQQ, NVDA), CBOE public delayed JSON for futures (ES, NQ, YM, RTY).
- **Math:** fully vectorized Black-Scholes gamma over the strike grid (NumPy/SciPy, no loops): `GEX = Γ · (OIc − OIp) · S · 0.01 · 100`; walls from cumulative-GEX extremes; zero-gamma flip via nearest-crossing interpolation.
- **AI brief:** provider-agnostic desk briefing (Groq primary, Gemini fallback, static rule-based last) with a deterministic spot-vs-pivot truth guard. 5-minute per-ticker cache.
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
  "net_gex": 123456789.12,
  "chain_stale": false,
  "gex_profile": [
    { "strike": 540.0, "gex": -9876543.2, "oi_calls": 1240, "oi_puts": 18920, "iv": 0.1781 }
  ],
  "analysis": { "signal": "BULLISH_DRIFT", "summary": "…", "provider": "groq", "generated_at": "…" }
}
```

`GET /api/v1/candles?ticker=SPY&interval=1m&period=1d` → OHLC bar array for the chart canvas.

## Design language

Slate dark (`#0B0E14` canvas / `#1E293B` cards), bento grid, zero text walls:
- **Call Wall** — neon red `#EF4444` (short-gamma resistance)
- **Put Wall** — neon green `#22C55E` (long-gamma support)
- **LevelFlip / Zero Gamma** — electric amber `#F59E0B`

Regime badge (LONG GAMMA ⇄ SHORT GAMMA) is deterministic; ⚡ SHARE SETUP copies a dark-mode-ready setup to the clipboard.

## Disclaimer

Educational/experimental. Options data is end-of-day/delayed; not investment advice.
