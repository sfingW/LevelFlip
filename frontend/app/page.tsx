"use client";

import { useState } from "react";
import DeskBrief from "@/components/DeskBrief";
import Header from "@/components/Header";
import IofMap from "@/components/IofMap";
import StatStrip from "@/components/StatStrip";
import TacticalLadder from "@/components/TacticalLadder";
import { useIOFData } from "@/lib/api";

export default function Page() {
  const [ticker, setTicker] = useState("SPY");
  const { data, isLoading, error } = useIOFData(ticker);
  const longGamma = data ? data.regime === "LONG_GAMMA" : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-[1440px] flex-col gap-3 px-4 pb-4 pt-5">
      <Header
        ticker={ticker}
        onTickerChange={setTicker}
        data={data}
        loading={isLoading}
        error={error}
      />

      <StatStrip data={data} />

      <section className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <IofMap data={data} />

        <div className="flex flex-col gap-3">
          <DeskBrief data={data} />

          {/* dealer regime — one screen, one truth */}
          <div className="card flex flex-1 flex-col justify-center">
            <div className="level-label">Dealer Regime</div>
            {longGamma === null ? (
              <div className="mt-2 h-8 w-40 animate-pulse rounded bg-white/[0.06]" />
            ) : (
              <>
                <div
                  className={`mt-1 font-mono text-3xl font-black tracking-tight ${
                    longGamma ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {longGamma ? "LONG GAMMA" : "SHORT GAMMA"}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  {longGamma
                    ? "Dealers are net-long gamma — their hedging dampens moves: dips get absorbed, rallies get faded. Volatility compresses."
                    : "Dealers are net-short gamma — their hedging amplifies moves: drops force selling, surges force buying. Volatility expands."}
                </p>
              </>
            )}
          </div>
        </div>
      </section>

      <TacticalLadder data={data} />

      <footer className="pb-2 pt-1 text-center text-[10px] uppercase tracking-widest text-slate-600">
        LevelFlip — dealer gamma positioning · futures quotes delayed · not investment advice
      </footer>
    </main>
  );
}
