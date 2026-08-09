"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { formatBig, formatPrice } from "@/lib/api";
import type { IOFPayload } from "@/types/levelFlip";

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
    const regime = data.spot_price >= data.gamma_flip ? "LONG GAMMA" : "SHORT GAMMA";
    const text = [
      `⚡ LEVELFLIP — ${data.ticker} SETUP`,
      `━━━━━━━━━━━━━━━━━`,
      `📊 SPOT: $${formatPrice(data.spot_price)}`,
      `🔴 CALL WALL: $${formatPrice(data.call_wall)}`,
      `🟠 LEVELFLIP: $${formatPrice(data.gamma_flip)}`,
      `🟢 PUT WALL: $${formatPrice(data.put_wall)}`,
      `🧲 NET GEX: ${formatBig(data.net_gex)}`,
      `💀 REGIME: ${regime}`,
      `━━━━━━━━━━━━━━━━━`,
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
    setToast("⚡ Setup copied to clipboard");
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }, [data]);

  const spot = data?.spot_price;
  const flip = data?.gamma_flip;
  const longGamma = spot !== undefined && flip !== undefined && spot >= flip;

  return (
    <header className="flex flex-col gap-3 border-b border-edge pb-4 md:flex-row md:items-center md:justify-between">
      {/* brand + ticker search */}
      <div className="flex items-center gap-4">
        <div className="text-2xl font-black tracking-tight text-slate-100">
          LEVEL<span className="text-flip">FLIP</span>
        </div>
        <form onSubmit={submit} className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            placeholder="SPY / ES / NVDA"
            spellCheck={false}
            autoComplete="off"
            className="w-28 rounded-lg border border-edge bg-canvas px-3 py-1.5 font-mono text-sm uppercase tracking-wider text-slate-100 outline-none placeholder:text-slate-500 focus:border-flip/60 md:w-32"
          />
          <button
            type="submit"
            className="rounded-lg border border-edge bg-card px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-300 hover:border-flip/60 hover:text-flip"
          >
            Go
          </button>
        </form>
      </div>

      {/* spot / regime / share */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-4">
          {/* live spot */}
          <div>
            <div className="level-label">Spot</div>
            <div className="font-mono text-xl font-bold tabular-nums text-slate-100">
              {spot !== undefined ? `$${formatPrice(spot)}` : loading ? "…" : "--"}
            </div>
          </div>

          {/* net GEX */}
          <div>
            <div className="level-label">Net GEX</div>
            <div className="font-mono text-xl font-bold tabular-nums text-slate-100">
              {data ? formatBig(data.net_gex) : "--"}
            </div>
          </div>

          {/* pulsing regime badge */}
          <span
            title={
              longGamma
                ? "Price above zero-gamma pivot — dealer flow dampens volatility"
                : "Price below zero-gamma pivot — dealer flow accelerates volatility"
            }
            className={`rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest ${
              longGamma ? "animate-badge-green" : "animate-badge-red"
            }`}
            style={{
              color: longGamma ? "#22C55E" : "#EF4444",
              background: longGamma ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
            }}
          >
            {longGamma ? "◆ Long Gamma" : "▼ Short Gamma"}
          </span>

          {/* LLM signal chip — hover for the desk brief (no text walls) */}
          {data?.analysis && (
            <span
              title={data.analysis.summary}
              className="hidden cursor-help rounded-md border border-edge bg-card px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 sm:inline-block"
            >
              {data.analysis.signal}
            </span>
          )}
        </div>

        {/* primary CTA */}
        <button
          onClick={share}
          disabled={!data}
          className="animate-glow-amber rounded-lg bg-flip px-4 py-2 text-sm font-bold text-slate-950 transition hover:brightness-110 active:scale-95 disabled:animate-none disabled:opacity-40"
        >
          ⚡ SHARE SETUP
        </button>
      </div>

      {/* connection state dots */}
      <span
        className="absolute right-4 top-4 h-2 w-2 rounded-full"
        style={{
          background: error ? "#EF4444" : loading && !data ? "#F59E0B" : "#22C55E",
        }}
        title={error ? `API error: ${error.message}` : loading && !data ? "connecting…" : "live"}
      />

      {/* clipboard toast */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-flip/40 bg-card px-4 py-2 text-sm font-medium text-flip shadow-xl">
          {toast}
        </div>
      )}
    </header>
  );
}
