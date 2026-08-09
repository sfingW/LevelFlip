# LevelFlip — Session Status (2026-08-09, VEX/DEX + expiry analytics + vol surface + multi-page)

## Done ✅
- **VEX & DEX tracking in the engine** — dollar delta exposure (DEX = Δ·OI·S·100, puts negative) and dollar vanna exposure (VEX = Vanna·OI·S·100) computed per-strike across all expiries, cross-checked against the ∂Δ/∂σ = ∂Vega/∂S identity. Surfaced as `net_dex`/`net_vex` on the IOF payload and `dex`/`vex` on every GexBar; terminal StatStrip shows Net DEX / Net VEX tiles; SHARE SETUP text includes them.
- **Expiry analytics** — `/api/v1/expiry_gex`: per-expiry dollar-GEX grids (each expiry keeps its own grid pre-merge) + 0DTE/Weekly/Monthly/LEAPS breakdown with pct of net GEX. Verified live: 4 expiries, weekly 8/11–8/14.
- **Vol surface** — `/api/v1/vol`: LSE lane (live! source=LSE, 7 expiries) with per-expiry IV smiles, delta/gamma/vega, ATM IV at spot, 25Δ skew via delta-anchored interpolation (25Δ put = call-delta 0.75); term structure; deterministic vol signals (HV30, IV/HV premium, term shape, skew stress, vol regime). Chain lane (yfinance) backfills when LSE is down. Verified live: CONTANGO, PUT_SKEW_STRESS (fixed sign: skew_25 = put IV − call IV, positive = puts rich), CHEAP.
- **Options flow live** — LSE live key works: `/api/v1/flow` returns 100 real prints ≥$100k with `dte` + `delta` passthrough. FlowPanel on the terminal now shows real data.
- **Frontend motion** — restrained CSS-only animations (`animate-rise` fade-up with stagger, `animate-grow-x` value bars, `animate-breathe` live readout, `animate-flash` value-change pulse, `animate-cell-in` heatmap cells).
- **Multi-page site** — `/heatmap` (breakdown chips + strike×expiry GEX matrix, windowed ±4% around spot, call-red/put-green intensity), `/chain` (strike ladder: OI calls/puts, IV, GEX/DEX/VEX columns + GEX/DEX/VEX mini profile bars, wall/flip/max-pain markers, cumulative filter), `/vol` (signal chips + ATM term-structure SVG + per-expiry smile SVG with expiry selector), `/flow` (stat strip, fast-money short-dated filter, full tape table). Shared `PageShell` (nav, market-state banner, ticker switcher, live spot). NavBar links to all six pages. Build green, all routes 200, auth 401 gate verified on new endpoints.
- **LSE adapter** — probe-verified the real vault schema (no OI on chain rows; explicit `expiry=` works; flow returns ts/contract_type/premium/volume/greeks). Chain strategy: iterate next 8 Fridays explicitly, 300s cache, `_oi_absent` fast-fail. GEX stays yfinance-anchored (LSE has no OI); LSE feeds vol + flow. Live key wired (`London_STRATEGIC_EDGE_API_KEY_LIVE` in backend/.env).

## Run locally
```
cd C:\dev\LevelFlip\backend; python main.py      # :8000
cd C:\dev\LevelFlip\frontend; npm run dev        # :3000
```

## Notes
- `.env` (backend + `frontend/.env.local`) gitignored — never commit. Keep `NEXT_PUBLIC_LEVELFLIP_API_KEY` in sync with `LEVELFLIP_API_KEY`.
- Quant paper lives in `research\` (gitignored — never commit).
- Keys/format: dollar GEX = Γ·(OIc−OIp)·S²·0.01·100; DEX = Δ·OI·S·100 (puts negative); VEX = Vanna·OI·S·100 per vol point; Max Pain via cumsum; EM = S·σ_ATM·√(DTE/365).
- Vol signals are **deterministic analytics** (IV/HV premium, term shape, skew stress, regime) — an honest downgrade of the "ML vol signals" ask given our data; the models say so in their docstrings.
- `/api/v1/flow` needs the LSE live key; if it rotates, the lane cools down and flow 502s (FlowPanel degrades quietly).
