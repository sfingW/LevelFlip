# LevelFlip — Session Status (2026-08-09, evening update)

## Done ✅
- **IOF section live** — battle map, stat strip, tactical ladder, desk brief
- **Multi-expiry engine** — top-4 front months, exact DTE gamma, unified dollar-GEX matrix, walls = dollar-GEX peaks, `regime` in payload. Acceptance test passed.
- **Interactive map** — hover tooltips (GEX/OI/IV/delta), 2.5D prism bars. Build green, 115 kB.
- **AI analyst verified** — live Groq 200 OK (signal BULLISH_DRIFT, real numbers).
- Committed + pushed: `5c9fcee` ✅, `b351a47` ✅ (remote main == local, verified).
- **Backend restarted on :8000** with post-refactor code — `/api/v1/iof?ticker=SPY` returns `regime: LONG_GAMMA`, 161 bars, Groq analysis. CORS ok.
- **Frontend running on :3000** — clean compile (568 modules), no casing warnings, GET / 200.
- **Stale `documents\LevelFlip` emptied** — only the empty root folder remains (locked by the active session; auto-removable once that session exits).

## Run locally
```
cd C:\dev\LevelFlip\backend; python main.py      # :8000
cd C:\dev\LevelFlip\frontend; npm run dev        # :3000
```

## Notes
- Quant paper lives in `research\` (gitignored — never commit).
- `.env` with keys is in `C:\dev\LevelFlip\backend\.env` (safe).
- Keys/format: dollar GEX = Γ·(OIc−OIp)·S²·0.01·100; Max Pain via cumsum; EM = S·σ_ATM·√(DTE/365).
- Next session: launch Claude Code from `C:\dev\LevelFlip` (not the old documents path).
