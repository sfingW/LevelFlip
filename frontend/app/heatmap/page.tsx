"use client";

import PageShell from "@/components/PageShell";
import { useExpiryGex } from "@/lib/api";
import type { ExpiryGexPayload } from "@/types/levelFlip";

/**
 * GEX heatmap by expiration — one cell per (expiry, strike) showing that
 * expiry's own dollar-GEX, colored call-wall red / put-wall green, with the
 * 0DTE / Weekly / Monthly / LEAPS breakdown on top.
 */
export default function HeatmapPage() {
  return (
    <PageShell
      title="GEX Heatmap by Expiration"
      subtitle="Dollar gamma by expiry × strike. Red cells are call-gamma (dealers buy high), green cells put-gamma (dealers sell low) — the flip from red to green marks where dealer hedging turns."
    >
      {(ticker) => <Heatmap ticker={ticker} />}
    </PageShell>
  );
}

const BUCKET_COLORS: Record<string, string> = {
  "0DTE": "#F59E0B",
  WEEKLY: "#38BDF8",
  MONTHLY: "#A78BFA",
  LEAPS: "#64748B",
};

function Heatmap({ ticker }: { ticker: string }) {
  const { data, isLoading, error } = useExpiryGex(ticker);
  if (error) return <ErrorCard message={error.message} />;
  if (isLoading || !data) return <div className="h-96 animate-pulse rounded-2xl bg-white/[0.04]" />;

  return (
    <div className="flex flex-col gap-3">
      <Breakdown data={data} />
      <Matrix data={data} />
    </div>
  );
}

function Breakdown({ data }: { data: ExpiryGexPayload }) {
  const total = Math.abs(data.breakdown.reduce((s, r) => s + r.dollar_gex, 0)) || 1;
  return (
    <div className="animate-rise grid grid-cols-2 gap-3 md:grid-cols-4">
      {data.breakdown.map((row, i) => {
        const bucket = row.bucket in BUCKET_COLORS ? row.bucket : "WEEKLY";
        const color = BUCKET_COLORS[bucket];
        const pctOfTotal = Math.abs(row.dollar_gex) / total;
        return (
          <div key={row.expiry} className={`card animate-rise rise-delay-${Math.min(i, 3)}`}>
            <div className="flex items-center justify-between">
              <span className="level-label" style={{ color }}>
                {row.bucket} · dte {row.dte}
              </span>
              <span className="text-[10px] font-mono text-slate-500">{row.expiry}</span>
            </div>
            <div className="mt-1.5 font-mono text-xl font-bold tabular-nums text-slate-100">
              ${(row.dollar_gex / 1e9).toFixed(2)}B
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="animate-grow-x h-full rounded-full"
                style={{ width: `${Math.min(100, pctOfTotal * 100)}%`, background: color }}
              />
            </div>
            <div className="mt-1 text-[10px] font-mono text-slate-500">
              {Math.abs(row.pct * 100).toFixed(1)}% of net GEX · OI{" "}
              {(row.oi_calls + row.oi_puts) / 1e6 > 0.1
                ? `${((row.oi_calls + row.oi_puts) / 1e6).toFixed(2)}M`
                : `${(row.oi_calls + row.oi_puts) / 1e3 >= 1 ? `${((row.oi_calls + row.oi_puts) / 1e3).toFixed(0)}K` : (row.oi_calls + row.oi_puts).toFixed(0)}`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Matrix({ data }: { data: ExpiryGexPayload }) {
  const rows = data.expiries;
  // union of all strikes across expiries, clamped to the display window
  const allStrikes = [...new Set(rows.flatMap((r) => r.strikes))].sort((a, b) => a - b);
  const spot = data.spot;
  // window: ±4% around spot (dense enough to read), or full range if small
  const lo = spot * 0.94;
  const hi = spot * 1.06;
  const strikes = allStrikes.filter((s) => s >= lo && s <= hi);
  const left = allStrikes.filter((s) => s < lo).length;
  const right = allStrikes.filter((s) => s > hi).length;

  // global abs-max GEX for color scaling (per-row would hide weak expiries)
  const maxAbs = Math.max(
    1,
    ...rows.map((r) => Math.max(...r.gex.map((g) => Math.abs(g)))),
  );

  return (
    <div className="animate-rise rise-delay-1 card overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <span className="level-label">Dollar GEX by strike × expiry</span>
        <span className="font-mono text-[10px] text-slate-500">
          window ±4% · {strikes.length} strikes {left > 0 && `( +${left} OTM left )`}
          {right > 0 && ` ( +${right} OTM right )`}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-card px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Strike
              </th>
              {rows.map((r) => (
                <th
                  key={r.expiry}
                  className="px-1 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: BUCKET_COLORS[r.dte === 0 ? "0DTE" : r.dte <= 7 ? "WEEKLY" : r.dte <= 45 ? "MONTHLY" : "LEAPS"] }}
                >
                  {r.expiry.slice(5)} · d{r.dte}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {strikes.map((s, si) => (
              <tr key={s}>
                <td
                  className={`sticky left-0 z-10 bg-card px-2 py-0.5 font-mono text-[11px] tabular-nums ${
                    Math.abs(s - spot) / spot < 0.002
                      ? "font-bold text-flip"
                      : "text-slate-400"
                  }`}
                >
                  {s.toFixed(0)}
                  {Math.abs(s - spot) / spot < 0.002 && " ◈"}
                </td>
                {rows.map((r, ri) => {
                  const idx = r.strikes.indexOf(s);
                  const g = idx >= 0 ? r.gex[idx] : 0;
                  const intensity = Math.min(1, Math.abs(g) / maxAbs);
                  const bg =
                    g === 0
                      ? "transparent"
                      : g > 0
                        ? `rgba(239,68,68,${0.06 + intensity * 0.5})`
                        : `rgba(34,197,94,${0.06 + intensity * 0.5})`;
                  return (
                    <td
                      key={r.expiry}
                      className="px-1 py-0.5 text-center font-mono text-[10px] tabular-nums"
                      style={{ background: bg, animationDelay: `${(si + ri * 3) * 12}ms` }}
                      title={
                        idx >= 0
                          ? `${s.toFixed(0)} · ${r.expiry}: GEX ${(g / 1e6).toFixed(1)}M · OI C${r.oi_calls[idx].toFixed(0)}/P${r.oi_puts[idx].toFixed(0)} · IV ${(r.iv[idx] * 100).toFixed(1)}%`
                          : undefined
                      }
                    >
                      <span className="animate-cell-in inline-block">
                        {idx >= 0 && Math.abs(g) >= maxAbs * 0.05 ? `${(g / 1e6).toFixed(1)}` : ""}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="animate-rise card border-red-500/30 py-8 text-center">
      <div className="font-mono text-sm text-red-400">Heatmap unavailable</div>
      <div className="mt-1 text-xs text-slate-500">{message}</div>
    </div>
  );
}
