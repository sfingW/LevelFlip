"use client";

import { useState } from "react";
import NavBar from "@/components/NavBar";
import MarketStateBanner from "@/components/MarketStateBanner";
import { useIOFData } from "@/lib/api";

const QUICK_TICKERS = ["SPY", "ES", "NQ", "QQQ", "NVDA", "IWM"];

interface PageShellProps {
  /** Optional initial ticker — pages without URL params start on SPY. */
  initialTicker?: string;
  title: string;
  subtitle: string;
  children: (ticker: string) => React.ReactNode;
}

/**
 * Shared scaffold for the analytics pages (Heatmap / Chain / Vol / Flow):
 * nav, market-state banner, ticker switcher, and the live spot readout —
 * one consistent shell so each page owns only its chart.
 */
export default function PageShell({ initialTicker = "SPY", title, subtitle, children }: PageShellProps) {
  const [ticker, setTicker] = useState(initialTicker.toUpperCase());
  const { data, isLoading } = useIOFData(ticker, 60_000);

  return (
    <main className="min-h-screen">
      <NavBar />

      <div className="mx-auto flex max-w-[1440px] flex-col gap-3 px-4 pb-4 pt-4">
        <MarketStateBanner state={data?.market_state} />

        <div className="animate-rise flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight text-slate-100">
              {title}
            </h1>
            <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-slate-500">{subtitle}</p>
          </div>

          <div className="flex items-center gap-2">
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.trim().toUpperCase())}
              spellCheck={false}
              autoComplete="off"
              aria-label="Ticker"
              className="w-32 rounded-lg border border-edge bg-white/[0.04] px-3 py-2 font-mono text-sm uppercase tracking-wider text-slate-100 outline-none placeholder:text-slate-500 focus:border-flip/60"
            />
            <div className="hidden gap-1.5 sm:flex">
              {QUICK_TICKERS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTicker(t)}
                  className={`chip ${t === ticker ? "chip-active" : ""}`}
                >
                  {t}
                </button>
              ))}
            </div>
            <span className="hidden items-center gap-2 rounded-md border border-edge/70 bg-white/[0.03] px-2.5 py-1.5 lg:flex">
              <span className="relative flex h-1.5 w-1.5">
                <span
                  className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${
                    isLoading ? "bg-amber-400" : "bg-green-400"
                  }`}
                />
                <span
                  className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                    isLoading ? "bg-amber-400" : "bg-green-400"
                  }`}
                />
              </span>
              <span className="font-mono text-sm font-bold tabular-nums text-slate-100">
                {data ? `$${data.spot_price.toFixed(2)}` : "--"}
              </span>
            </span>
          </div>
        </div>

        {children(ticker)}

        <footer className="pb-2 pt-1 text-center text-[10px] uppercase tracking-widest text-slate-600">
          LevelFlip — dealer gamma positioning · futures quotes delayed · not investment advice
        </footer>
      </div>
    </main>
  );
}
