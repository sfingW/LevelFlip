"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { formatBig, formatPrice } from "@/lib/api";
import { BoltIcon } from "@/components/icons";
import type { IOFPayload } from "@/types/levelFlip";

const QUICK_TICKERS = ["SPY", "ES", "NQ", "QQQ", "NVDA", "IWM"];

interface HeaderProps {
  ticker: string;
  onTickerChange: (t: string) => void;
  data: IOFPayload | undefined;
  loading: boolean;
  error: Error | undefined;
}

export default function Header({ ticker, onTickerChange, data, loading, error }: HeaderProps) {
  const [input, setInput] = useState(ticker);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => setInput(ticker), [ticker]);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const submit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const t = input.trim().toUpperCase();
      if (t) onTickerChange(t);
    },
    [input, onTickerChange]
  );

  const share = useCallback(async () => {
    if (!data) return;
    const pct = (k: number) => {
      const p = ((k - data.spot_price) / data.spot_price) * 100;
      return `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`;
    };
    const regime = data.regime === "LONG_GAMMA" ? "LONG GAMMA" : "SHORT GAMMA";
    const text = [
      `◆ LEVELFLIP — ${data.ticker} IOF SETUP`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `▲ SPOT       $${formatPrice(data.spot_price)}`,
      `■ CALL WALL  $${formatPrice(data.call_wall)}  (${pct(data.call_wall)})`,
      `⇄ LEVELFLIP  $${formatPrice(data.gamma_flip)}  (${pct(data.gamma_flip)})`,
      `★ MAX PAIN   $${formatPrice(data.max_pain)}`,
      `▼ PUT WALL   $${formatPrice(data.put_wall)}  (${pct(data.put_wall)})`,
      `≈ 1σ MOVE    ±$${formatPrice(data.expected_move)}`,
      `≡ NET GEX    ${formatBig(data.net_gex)}`,
      `◈ REGIME     ${regime}`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // legacy fallback (non-secure contexts)
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setToast("Setup copied — paste it anywhere");
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }, [data]);

  const spot = data?.spot_price;
  const longGamma = data?.regime === "LONG_GAMMA";

  return (
    <header className="flex flex-col gap-4">
      {/* topbar: brand + actions */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {/* regime badge */}
          <span
            title={
              longGamma
                ? "Total net GEX positive — dealer hedging dampens volatility"
                : "Total net GEX negative — dealer hedging amplifies volatility"
            }
            className={`hidden rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest sm:inline-block ${
              longGamma ? "animate-badge-green" : "animate-badge-red"
            }`}
            style={{
              color: longGamma ? "#22C55E" : "#EF4444",
              background: longGamma ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
            }}
          >
            {longGamma ? "◆ Long Gamma" : "▼ Short Gamma"}
          </span>

          {/* LLM signal chip — hover for the desk brief */}
          {data?.analysis && (
            <span
              title={data.analysis.summary}
              className="hidden cursor-help rounded-md border border-edge bg-white/[0.04] px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 lg:inline-block"
            >
              {data.analysis.signal}
            </span>
          )}

          {/* the one action that matters */}
          <button
            onClick={share}
            disabled={!data}
            className="animate-glow-amber flex items-center gap-1.5 rounded-lg bg-flip px-4 py-2 text-sm font-bold text-slate-950 transition hover:brightness-110 active:scale-95 disabled:animate-none disabled:opacity-40"
          >
            <BoltIcon className="h-4 w-4" />
            SHARE SETUP
          </button>
        </div>
      </div>

      {/* hero row: zero-friction ticker + live desk numbers */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <form onSubmit={submit} className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              placeholder="SPY / ES / NVDA"
              spellCheck={false}
              autoComplete="off"
              className="w-40 rounded-lg border border-edge bg-white/[0.04] px-3 py-2 font-mono text-base uppercase tracking-wider text-slate-100 outline-none placeholder:text-slate-500 focus:border-flip/60"
            />
            <button
              type="submit"
              className="rounded-lg border border-edge bg-white/[0.05] px-3.5 py-2 text-xs font-semibold uppercase tracking-wider text-slate-200 transition hover:border-flip/60 hover:text-flip"
            >
              Go
            </button>
          </form>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {QUICK_TICKERS.map((t) => (
              <button
                key={t}
                onClick={() => onTickerChange(t)}
                className={`chip ${t === ticker ? "chip-active" : ""}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-end gap-6">
          <div>
            <div className="level-label flex items-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span
                  className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${
                    error ? "bg-red-400" : "bg-green-400"
                  }`}
                />
                <span
                  className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                    error ? "bg-red-400" : "bg-green-400"
                  }`}
                />
              </span>
              {error ? "Spot · degraded" : "Spot · live"}
            </div>
            <div className="font-mono text-5xl font-black tabular-nums tracking-tight text-slate-50">
              {spot !== undefined ? `$${formatPrice(spot)}` : loading ? "…" : "--"}
            </div>
          </div>
          <div className="flex gap-6 pb-1">
            <div>
              <div className="level-label">Net GEX</div>
              <div className="font-mono text-xl font-bold tabular-nums text-slate-100">
                {data ? formatBig(data.net_gex) : "--"}
              </div>
            </div>
            <div>
              <div className="level-label">1σ Move</div>
              <div className="font-mono text-xl font-bold tabular-nums text-slate-100">
                {data ? `±$${formatPrice(data.expected_move)}` : "--"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* clipboard toast */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-lg border border-flip/40 bg-card px-4 py-2 text-sm font-medium text-flip shadow-xl">
          {toast}
        </div>
      )}
    </header>
  );
}
