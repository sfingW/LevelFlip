# LevelFlip — Session Status (2026-08-09, security + lanes + multi-page)

## Done ✅
- **API key auth** — `X-API-Key` on all `/api/v1/*` routes, constant-time compare. Verified: no key → 401, wrong key → 401, good key → 200. Dev mode (no `LEVELFLIP_API_KEY`) auto-disables.
- **Rate limiting** (slowapi) — keyed clients share one bucket (iof 60/min) so the polling UI never trips; verified 60×200 then 429. Anon traffic is blocked at the 401 gate (stronger than a per-IP limit).
- **Market-closed state** — `market_state` in IOF payload (ET weekday-approx); frontend `MarketStateBanner` renders "Market closed" strips instead of crashing. Verified on Sunday: `market_state: closed`, UI shows banner.
- **Provider lanes** (`backend/data_lanes.py`) — LSE chain (OI-gated) → Alpha Vantage EOD baseline (20 calls/day) → yfinance; spot Finnhub → FMP → yfinance (CBOE first for futures); news Market Aux → NewsAPI; 600s cooldown parks failing lanes. LSE key currently 401s (needs activation at londonstrategicedge.com/data) — chain anchors to yfinance, flow 502s.
- **New endpoints** — `/api/v1/news` (ticker or broad `MARKET` feed, 300s cache) and `/api/v1/flow` (LSE prints ≥$100k, 30s cache, 502 until LSE key works).
- **Desk brief now gets live headlines** as prompt context — verified live Groq briefing (BEARISH_PRESSURE, provider=groq).
- **Multi-page frontend** — homepage `/` (hero, market snapshot, headline grid), terminal at `/terminal` (query-param ticker like `?ticker=ES`), NavBar, FlowPanel (quiet unavailable state on 502). Build green, both routes 200.
- Committed + pushed: `bdfac85` ✅ (remote main == local, verified).

## Run locally
```
cd C:\dev\LevelFlip\backend; python main.py      # :8000
cd C:\dev\LevelFlip\frontend; npm run dev        # :3000
```

## Notes
- `.env` (backend + `frontend/.env.local`) gitignored — never commit. Keep `NEXT_PUBLIC_LEVELFLIP_API_KEY` in sync with `LEVELFLIP_API_KEY`.
- Quant paper lives in `research\` (gitignored — never commit).
- Keys/format: dollar GEX = Γ·(OIc−OIp)·S²·0.01·100; Max Pain via cumsum; EM = S·σ_ATM·√(DTE/365).
- **LSE key `sk-bdaa...` returns 401** — user must activate the key at londonstrategicedge.com/data (or swap in an `lse_live_...` key). Until then: chain falls back, `/api/v1/flow` = 502, FlowPanel shows "feed unavailable".
- Next session: launch Claude Code from `C:\dev\LevelFlip`.
