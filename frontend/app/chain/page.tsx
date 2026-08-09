"use client";

import { useMemo, useState } from "react";
import PageShell from "@/components/PageShell";
import { formatBig, formatSigma, useIOFData } from "@/lib/api";
import type { IOFPayload } from "@/types/levelFlip";

/**
 * Full option-chain ladder: per-strike call/put OI, IV, and the three dealer
 * exposure legs — GEX, DEX, VEX — plus the cumulative gamma profile and
 * wall markers. This is the "deep desk" view of the IOF snapshot.
 */
export default function ChainPage() {
  return (
    <PageShell
      title="Option Chain — Strike Ladder"
      subtitle="Per-strike dealer exposure: dollar gamma (GEX), dollar delta (DEX), and dollar vanna (VEX). Bars scale to the row's share of net exposure; the purple line is cumulative gamma."
    >
      {(ticker) => <Chain ticker={ticker} />}
    </PageShell>
  );
}

function Chain({ ticker }: { ticker: string }) {
  const { data, isLoading, error } = useIOFData(ticker, 10_000);
  const [showZero, setShowZero] = useState(true);

  const rows = useMemo(() => {
    if (!data) return [];
    const bars = data.gex_profile.filter((b) => showZero || b.gex !== 0);
    const maxAbs = Math.max(1, ...bars.map((b) => Math.max(Math.abs(b.gex), Math.abs(b.dex), Math.abs(b.vex))));
    return bars.map((b) => ({ ...b, maxAbs }));
  }, [data, showZero]);

  if (error) {
    return (
      <div className="animate-rise card border-red-500/30 py-8 text-center">
        <div className="font-mono text-sm text-red-400">Chain unavailable</div>
        <div className="mt-1 text-xs text-slate-500">{error.message}</div>
      </div>
    );
  }
  if (isLoading || !data) return <div className="h-96 animate-pulse rounded-2xl bg-white/[0.04]" />;

  const { call_wall, put_wall, gamma_flip, max_pain, spot_price } = data;
  const markers = new Map<number, string>([
    [call_wall, "CALL WALL"],
    [gamma_flip, "FLIP"],
    [max_pain, "MAX PAIN"],
    [put_wall, "PUT WALL"],
  ]);

  return (
    <div className="flex flex-col gap-3">
      {/* key levels strip */}
      <div className="animate-rise grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          { label: "Call Wall", value: call_wall, color: "#EF4444" },
          { label: "Gamma Flip", value: gamma_flip, color: "#F59E0B" },
          { label: "Max Pain", value: max_pain, color: "#A78BFA" },
          { label: "Put Wall", value: put_wall, color: "#22C55E" },
        ].map((k, i) => (
          <div key={k.label} className={`card animate-rise rise-delay-${i + 1} py-2.5`}>
            <div className="level-label" style={{ color: k.color }}>
              {k.label}
            </div>
            <div className="mt-0.5 font-mono text-lg font-bold tabular-nums text-slate-100">
              ${k.value.toFixed(2)}
            </div>
          </div>
        ))}
      </div>

      {/* the ladder */}
      <div className="animate-rise rise-delay-2 card overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
          <span className="level-label">Strike ladder · {data.gex_profile.length} strikes</span>
          <label className="flex cursor-pointer items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            <input
              type="checkbox"
              checked={showZero}
              onChange={(e) => setShowZero(e.target.checked)}
              className="h-3 w-3 accent-amber-500"
            />
            show zero-GEX rows
          </label>
        </div>
        <div className="max-h-[70vh] overflow-y-auto">
          <table className="w-full min-w-[680px] border-collapse">
            <thead className="sticky top-0 z-10 bg-card">
              <tr>
                <th className="px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Strike</th>
                <th className="px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">OI Calls</th>
                <th className="px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">OI Puts</th>
                <th className="px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">IV</th>
                <th className="px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">GEX</th>
                <th className="px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">DEX</th>
                <th className="px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">VEX</th>
                <th className="w-[22%] px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Profile</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const marker = markers.get(b.strike);
                const near = Math.abs(b.strike - spot_price) / spot_price < 0.002;
                return (
                  <tr
                    key={b.strike}
                    className={`border-t border-white/[0.04] ${near ? "bg-flip/[0.05]" : ""} ${marker ? "bg-white/[0.03]" : ""}`}
                  >
                    <td className="px-3 py-1 font-mono text-[11px] tabular-nums text-slate-300">
                      {b.strike.toFixed(0)}
                      {near && <span className="ml-1 text-flip">◈</span>}
                      {marker && (
                        <span
                          className="ml-1.5 rounded px-1 py-px text-[8px] font-bold uppercase tracking-wider text-slate-950"
                          style={{ background: marker === "CALL WALL" ? "#EF4444" : marker === "PUT WALL" ? "#22C55E" : marker === "FLIP" ? "#F59E0B" : "#A78BFA" }}
                        >
                          {marker}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-[11px] tabular-nums text-red-300/80">{b.oi_calls.toLocaleString()}</td>
                    <td className="px-2 py-1 text-right font-mono text-[11px] tabular-nums text-green-300/80">{b.oi_puts.toLocaleString()}</td>
                    <td className="px-2 py-1 text-right font-mono text-[11px] tabular-nums text-slate-400">{formatSigma(b.iv)}</td>
                    <td className="px-2 py-1 text-right font-mono text-[11px] font-semibold tabular-nums" style={{ color: b.gex > 0 ? "#F87171" : b.gex < 0 ? "#4ADE80" : "#64748B" }}>
                      {formatBig(b.gex)}
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-[11px] font-semibold tabular-nums" style={{ color: b.dex > 0 ? "#FBBF24" : "#60A5FA" }}>
                      {formatBig(b.dex)}
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-[11px] font-semibold tabular-nums text-slate-400">{formatBig(b.vex)}</td>
                    <td className="px-3 py-1">
                      <ProfileBar
                        gex={b.gex}
                        dex={b.dex}
                        vex={b.vex}
                        maxAbs={b.maxAbs}
                        strike={b.strike}
                        spot={spot_price}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Three mini-bars (GEX/DEX/VEX) per row, scaled to the grid max. */
function ProfileBar({
  gex,
  dex,
  vex,
  maxAbs,
  strike,
  spot,
}: {
  gex: number;
  dex: number;
  vex: number;
  maxAbs: number;
  strike: number;
  spot: number;
}) {
  const seg = (v: number, pos: string, neg: string) => {
    const w = Math.min(100, (Math.abs(v) / maxAbs) * 100);
    return (
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
        <div
          className="animate-grow-x absolute inset-y-0 rounded-full"
          style={{ left: "50%", width: `${w / 2}%`, background: v >= 0 ? pos : neg, transformOrigin: v >= 0 ? "left center" : "right center" }}
        />
      </div>
    );
  };
  return (
    <div className="flex items-center gap-1.5" title={`${strike.toFixed(0)} · GEX ${formatBig(gex)} · DEX ${formatBig(dex)} · VEX ${formatBig(vex)}${Math.abs(strike - spot) / spot < 0.002 ? " · spot" : ""}`}>
      {seg(gex, "#F87171", "#4ADE80")}
      {seg(dex, "#FBBF24", "#60A5FA")}
      {seg(vex, "#A78BFA", "#A78BFA")}
    </div>
  );
}
