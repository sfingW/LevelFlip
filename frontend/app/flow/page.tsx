"use client";

import { useMemo } from "react";
import PageShell from "@/components/PageShell";
import { useFlowData, useIOFData } from "@/lib/api";
import type { FlowPrint } from "@/types/levelFlip";

/**
 * Live options flow: large premium prints from London Strategic Edge with
 * greeks. Skewed toward interesting prints (dte ≤ 14, |delta| ≤ 0.6) at the
 * top, everything else below.
 */
export default function FlowPage() {
  return (
    <PageShell
      title="Options Flow"
      subtitle="Live premium prints ≥ $100k with dte and delta. Fast money skews short-dated — the desk filter surfaces 0–14 dte prints under 0.60 |delta| first."
    >
      {(ticker) => <Flow ticker={ticker} />}
    </PageShell>
  );
}

function Flow({ ticker }: { ticker: string }) {
  const { data, isLoading, error } = useFlowData(ticker);
  const { data: iof } = useIOFData(ticker, 60_000);

  const prints = useMemo(() => (data ? [...data.prints] : []), [data]);
  const hot = useMemo(() => {
    const hasDte = prints.filter((p) => p.dte != null);
    if (hasDte.length === 0) return prints.slice(0, 8);
    return [...hasDte]
      .sort((a, b) => (a.dte! <= 14 ? -1 : 1) - (b.dte! <= 14 ? -1 : 1) || b.premium - a.premium)
      .slice(0, 8);
  }, [prints]);

  const stats = useMemo(() => {
    if (prints.length === 0) return null;
    const calls = prints.filter((p) => p.type === "CALL");
    const puts = prints.filter((p) => p.type === "PUT");
    const totalPrem = prints.reduce((s, p) => s + p.premium, 0);
    return {
      prints: prints.length,
      calls: calls.length,
      puts: puts.length,
      callPrem: calls.reduce((s, p) => s + p.premium, 0),
      putPrem: puts.reduce((s, p) => s + p.premium, 0),
      totalPrem,
    };
  }, [prints]);

  if (error) {
    return (
      <div className="animate-rise card border-red-500/30 py-8 text-center">
        <div className="font-mono text-sm text-red-400">Flow feed unavailable</div>
        <div className="mt-1 text-xs text-slate-500">{error.message}</div>
      </div>
    );
  }
  if (isLoading || !data) return <div className="h-96 animate-pulse rounded-2xl bg-white/[0.04]" />;

  return (
    <div className="flex flex-col gap-3">
      {/* flow stats strip */}
      {stats && (
        <div className="animate-rise grid grid-cols-2 gap-2 md:grid-cols-5">
          {[
            { label: "Prints", value: `${stats.prints}`, color: "#E2E8F0" },
            { label: "Call prints", value: `${stats.calls}`, color: "#F87171" },
            { label: "Put prints", value: `${stats.puts}`, color: "#4ADE80" },
            { label: "Call prem", value: `$${(stats.callPrem / 1e6).toFixed(1)}M`, color: "#F87171" },
            { label: "Put prem", value: `$${(stats.putPrem / 1e6).toFixed(1)}M`, color: "#4ADE80" },
          ].map((s, i) => (
            <div key={s.label} className={`card animate-rise rise-delay-${i + 1} py-2.5`}>
              <div className="level-label">{s.label}</div>
              <div className="mt-0.5 font-mono text-lg font-bold tabular-nums" style={{ color: s.color }}>
                {s.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* hot money */}
      {hot.length > 0 && (
        <div className="animate-rise rise-delay-2 card p-0">
          <div className="border-b border-white/[0.06] px-4 py-2.5">
            <span className="level-label">Fast money — short-dated, out-of-the-money</span>
          </div>
          <div className="grid grid-cols-1 gap-1.5 p-3 sm:grid-cols-2">
            {hot.map((p, i) => (
              <PrintRow key={`${p.timestamp}-${p.contract}-${i}`} p={p} spot={iof?.spot_price} />
            ))}
          </div>
        </div>
      )}

      {/* full tape */}
      <div className="animate-rise rise-delay-3 card overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
          <span className="level-label">Full tape · min premium ${data.min_premium.toLocaleString()}</span>
          <span className="font-mono text-[10px] text-slate-500">{prints.length} prints</span>
        </div>
        <div className="max-h-[62vh] overflow-y-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead className="sticky top-0 z-10 bg-card">
              <tr>
                <th className="px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Time</th>
                <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Side</th>
                <th className="px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">Strike</th>
                <th className="px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">Premium</th>
                <th className="px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">Price</th>
                <th className="px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">Volume</th>
                <th className="px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">dte</th>
                <th className="px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">Δ</th>
                <th className="px-3 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">%Spot</th>
              </tr>
            </thead>
            <tbody>
              {prints.map((p, i) => (
                <PrintRow
                  key={`${p.timestamp}-${p.contract}-${i}`}
                  p={p}
                  spot={iof?.spot_price}
                  table
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PrintRow({ p, spot, table = false }: { p: FlowPrint; spot?: number; table?: boolean }) {
  const isCall = p.type === "CALL";
  const color = isCall ? "#F87171" : "#4ADE80";
  const pctSpot =
    spot != null && p.strike != null
      ? `${(((p.strike - spot) / spot) * 100).toFixed(1)}%`
      : "--";
  const time = p.timestamp ? new Date(p.timestamp).toLocaleTimeString("en-US", { hour12: false }) : "--";

  const content = (
    <>
      <span className="shrink-0 font-mono text-[10px] text-slate-500">{time}</span>
      <span className="shrink-0 text-[10px] font-black" style={{ color }}>
        {isCall ? "CALL" : "PUT"}
      </span>
      <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-slate-100">
        {p.strike?.toFixed(0) ?? "--"}
      </span>
      <span className="ml-auto shrink-0 font-mono text-[11px] font-bold tabular-nums" style={{ color }}>
        ${(p.premium / 1e3).toFixed(0)}K
      </span>
      <span className="hidden w-14 shrink-0 text-right font-mono text-[10px] tabular-nums text-slate-500 lg:inline">
        {p.price != null ? `$${p.price.toFixed(2)}` : "--"}
      </span>
      <span className="hidden w-12 shrink-0 text-right font-mono text-[10px] tabular-nums text-slate-500 lg:inline">
        {p.volume ?? "--"}
      </span>
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-slate-400">{p.dte != null ? `${p.dte}d` : "--"}</span>
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-slate-400">
        {p.delta != null ? (p.delta > 0 ? "+" : "") + p.delta.toFixed(2) : "--"}
      </span>
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-slate-500">{pctSpot}</span>
    </>
  );

  if (table) {
    return (
      <tr className="border-t border-white/[0.04] hover:bg-white/[0.02]">
        {[time, isCall ? "CALL" : "PUT", p.strike?.toFixed(0) ?? "--", `$${(p.premium / 1e3).toFixed(0)}K`, p.price != null ? `$${p.price.toFixed(2)}` : "--", p.volume ?? "--", p.dte != null ? `${p.dte}d` : "--", p.delta != null ? (p.delta > 0 ? "+" : "") + p.delta.toFixed(2) : "--", pctSpot].map(
          (v, i) => (
            <td
              key={i}
              className={`px-2 py-1 font-mono text-[11px] tabular-nums ${
                i === 0
                  ? "text-slate-500"
                  : i === 1
                    ? `font-black ${isCall ? "text-red-400" : "text-green-400"}`
                    : i === 2
                      ? "text-slate-100"
                      : i === 3
                        ? "font-bold text-slate-100"
                        : "text-slate-500"
              } ${i === 0 ? "pl-3" : ""} ${i === 8 ? "pr-3 text-right" : i >= 3 ? "text-right" : ""}`}
            >
              {v}
            </td>
          )
        )}
      </tr>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-1.5">
      {content}
    </div>
  );
}
