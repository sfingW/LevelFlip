"use client";

import { useState } from "react";
import GexProfileChart from "@/components/GexProfileChart";
import Header from "@/components/Header";
import MetricCards from "@/components/MetricCards";
import TradingViewChart from "@/components/TradingViewChart";
import { useCandles, useIOFData } from "@/lib/api";

export default function Page() {
  const [ticker, setTicker] = useState("SPY");
  const { data, isLoading, error } = useIOFData(ticker);
  const { data: candles } = useCandles(ticker);

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 p-4">
      <Header
        ticker={ticker}
        onTickerChange={setTicker}
        data={data}
        loading={isLoading}
        error={error}
      />

      {/* bento grid — mobile first: 1 col, md: levels row + chart/profile */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="md:col-span-3">
          <MetricCards data={data} />
        </div>

        <div className="card h-[400px] md:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="level-label">Price Action — 1m</span>
            <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
              {data ? `${data.ticker} · live spot overlay` : "connecting…"}
            </span>
          </div>
          <TradingViewChart candles={candles?.candles} data={data} />
        </div>

        <div className="card h-[400px]">
          <div className="mb-2 flex items-center justify-between">
            <span className="level-label">Net GEX by Strike</span>
            <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
              ±5% window
            </span>
          </div>
          <GexProfileChart data={data} />
        </div>
      </section>

      <footer className="pb-2 text-center text-[10px] uppercase tracking-widest text-slate-600">
        LevelFlip — dealer gamma positioning · futures quotes delayed
      </footer>
    </main>
  );
}
