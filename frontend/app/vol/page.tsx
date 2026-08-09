"use client";

import { useMemo, useState } from "react";
import PageShell from "@/components/PageShell";
import { useVolData } from "@/lib/api";
import type { VolExpiryRow, VolPayload } from "@/types/levelFlip";

/**
 * Volatility surface: per-expiry IV smiles, the ATM term structure, and the
 * deterministic vol signals (IV/HV premium, term shape, 25Δ skew stress).
 * Data is live LSE implied vols — not a model.
 */
export default function VolPage() {
  return (
    <PageShell
      title="Volatility Surface"
      subtitle="Live implied-vol smiles across expirations, the ATM term structure, and vol signals — HV/IV premium, term shape, and 25Δ skew stress. Data: London Strategic Edge."
    >
      {(ticker) => <Vol ticker={ticker} />}
    </PageShell>
  );
}

const SHAPE_COLOR: Record<string, string> = {
  CONTANGO: "#38BDF8",
  BACKWARDATION: "#F59E0B",
  FLAT: "#94A3B8",
};
const REGIME_COLOR: Record<string, string> = {
  EXPENSIVE: "#F87171",
  CHEAP: "#4ADE80",
  FAIR: "#94A3B8",
};
const SKEW_COLOR: Record<string, string> = {
  PUT_SKEW_STRESS: "#22C55E",
  CALL_SKEW_STRESS: "#EF4444",
  NEUTRAL_SKEW: "#94A3B8",
};

function Vol({ ticker }: { ticker: string }) {
  const { data, isLoading, error } = useVolData(ticker);
  if (error) {
    return (
      <div className="animate-rise card border-red-500/30 py-8 text-center">
        <div className="font-mono text-sm text-red-400">Vol surface unavailable</div>
        <div className="mt-1 text-xs text-slate-500">{error.message}</div>
      </div>
    );
  }
  if (isLoading || !data) return <div className="h-96 animate-pulse rounded-2xl bg-white/[0.04]" />;

  return (
    <div className="flex flex-col gap-3">
      <Signals data={data} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <TermStructure data={data} />
        <SmilePanel data={data} />
      </div>
    </div>
  );
}

function Signals({ data }: { data: VolPayload }) {
  const s = data.signals;
  const chips = [
    {
      label: "Vol Regime",
      value: s.vol_regime,
      color: REGIME_COLOR[s.vol_regime] ?? "#94A3B8",
      hint:
        s.vol_regime === "EXPENSIVE"
          ? "ATM IV trades >15% above realized vol — premium priced in"
          : s.vol_regime === "CHEAP"
            ? "ATM IV trades below realized vol — options cheap vs actual"
            : "ATM IV is roughly fair vs realized vol",
    },
    {
      label: "Term Shape",
      value: s.term_shape,
      color: SHAPE_COLOR[s.term_shape] ?? "#94A3B8",
      hint:
        s.term_shape === "CONTANGO"
          ? "Back-month IV above front — calm expectations"
          : s.term_shape === "BACKWARDATION"
            ? "Front-month IV above back — stress priced near-term"
            : "Flat curve",
    },
    {
      label: "25Δ Skew",
      value: s.skew_stress.replace(/_/g, " "),
      color: SKEW_COLOR[s.skew_stress] ?? "#94A3B8",
      hint:
        s.skew_stress === "PUT_SKEW_STRESS"
          ? "Puts rich vs calls at 25Δ — downside protection expensive"
          : s.skew_stress === "CALL_SKEW_STRESS"
            ? "Calls rich vs puts — upside chasing"
            : "Skew within normal band",
    },
  ];
  return (
    <div className="animate-rise grid grid-cols-1 gap-3 md:grid-cols-3">
      {chips.map((c, i) => (
        <div key={c.label} className={`card animate-rise rise-delay-${i + 1}`}>
          <div className="level-label">{c.label}</div>
          <div className="mt-1 font-mono text-lg font-bold tracking-tight" style={{ color: c.color }}>
            {c.value}
          </div>
          <div className="mt-1 text-[10px] leading-relaxed text-slate-500">{c.hint}</div>
        </div>
      ))}
      <div className="card col-span-full md:col-span-3">
        <div className="level-label">IV vs Realized Vol</div>
        <div className="mt-1 flex items-center gap-4 font-mono text-sm tabular-nums">
          <span className="text-slate-300">
            ATM IV{" "}
            <span className="font-bold text-slate-100">
              {data.term_structure[0]?.atm_iv != null ? `${(data.term_structure[0].atm_iv * 100).toFixed(1)}%` : "--"}
            </span>
          </span>
          <span className="text-slate-600">/</span>
          <span className="text-slate-300">
            HV30{" "}
            <span className="font-bold text-slate-100">
              {s.hv30 != null ? `${(s.hv30 * 100).toFixed(1)}%` : "--"}
            </span>
          </span>
          <span className="text-slate-600">→</span>
          <span className={s.iv_hv_premium != null && s.iv_hv_premium < 0 ? "font-bold text-green-400" : "font-bold text-red-400"}>
            {s.iv_hv_premium != null ? `${(s.iv_hv_premium * 100).toFixed(1)}% premium` : "--"}
          </span>
          <span className="ml-auto text-[10px] text-slate-600">source: {data.source}</span>
        </div>
      </div>
    </div>
  );
}

function TermStructure({ data }: { data: VolPayload }) {
  const pts = data.term_structure.filter((p) => p.atm_iv != null);
  if (pts.length === 0) return <EmptyCard label="No term-structure points" />;

  const W = 620;
  const H = 210;
  const pad = { l: 44, r: 12, t: 12, b: 26 };
  const xMax = Math.max(...pts.map((p) => p.dte));
  const yMin = Math.min(...pts.map((p) => p.atm_iv!)) * 0.9;
  const yMax = Math.max(...pts.map((p) => p.atm_iv!)) * 1.1;
  const x = (dte: number) => pad.l + ((dte - 0) / (xMax || 1)) * (W - pad.l - pad.r);
  const y = (iv: number) => pad.t + (1 - (iv - yMin) / (yMax - yMin || 1)) * (H - pad.t - pad.b);
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.dte).toFixed(1)},${y(p.atm_iv!).toFixed(1)}`).join(" ");

  return (
    <div className="animate-rise rise-delay-2 card overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <span className="level-label">ATM IV Term Structure</span>
        <span className="font-mono text-[10px] text-slate-500">days to expiry</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {[0.25, 0.5, 0.75, 1].map((f) => {
          const yy = pad.t + f * (H - pad.t - pad.b);
          return (
            <line key={f} x1={pad.l} x2={W - pad.r} y1={yy} y2={yy} stroke="rgba(255,255,255,0.05)" />
          );
        })}
        <path d={path} fill="none" stroke="#38BDF8" strokeWidth={2} strokeLinecap="round" />
        {pts.map((p, i) => (
          <g key={p.expiry}>
            <circle cx={x(p.dte)} cy={y(p.atm_iv!)} r={3.2} fill="#0B0E14" stroke="#38BDF8" strokeWidth={1.6} />
            {i % 2 === 0 && (
              <text x={x(p.dte)} y={y(p.atm_iv!) - 8} textAnchor="middle" fontSize={9} fill="#64748B" fontFamily="monospace">
                {(p.atm_iv! * 100).toFixed(1)}%
              </text>
            )}
          </g>
        ))}
        <text x={pad.l} y={H - 8} fontSize={9} fill="#475569" fontFamily="monospace">
          0d
        </text>
        <text x={x(xMax)} y={H - 8} textAnchor="end" fontSize={9} fill="#475569" fontFamily="monospace">
          {xMax}d
        </text>
      </svg>
    </div>
  );
}

function SmilePanel({ data }: { data: VolPayload }) {
  const [selected, setSelected] = useState<string | null>(null);
  const rows = data.expiries;
  const active = rows.find((r) => r.expiry === selected) ?? rows[0];
  if (!active) return <EmptyCard label="No smiles available" />;

  return (
    <div className="animate-rise rise-delay-3 card overflow-hidden p-0">
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-2.5">
        <span className="level-label">IV Smile · {active.expiry} · d{active.dte}</span>
        <select
          value={active.expiry}
          onChange={(e) => setSelected(e.target.value)}
          className="rounded-md border border-edge bg-card px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-slate-300 outline-none focus:border-flip/60"
        >
          {rows.map((r) => (
            <option key={r.expiry} value={r.expiry}>
              {r.expiry} · d{r.dte}
            </option>
          ))}
        </select>
      </div>
      <SmileChart row={active} spot={data.spot} />
      <div className="flex flex-wrap gap-3 border-t border-white/[0.06] px-4 py-2 font-mono text-[10px] tabular-nums text-slate-500">
        <span>ATM <span className="text-slate-300">{active.atm_iv != null ? `${(active.atm_iv * 100).toFixed(1)}%` : "--"}</span></span>
        <span>ATM strike <span className="text-slate-300">{active.atm_strike?.toFixed(0) ?? "--"}</span></span>
        <span>
          25Δ skew{" "}
          <span className={active.skew_25 != null && active.skew_25 > 0 ? "text-green-400" : active.skew_25 != null && active.skew_25 < 0 ? "text-red-400" : "text-slate-300"}>
            {active.skew_25 != null ? `${(active.skew_25 * 100).toFixed(1)}%` : "--"}
          </span>
        </span>
        <span className="ml-auto">{active.strikes.length} strikes</span>
      </div>
    </div>
  );
}

function SmileChart({ row, spot }: { row: VolExpiryRow; spot: number | null }) {
  const W = 620;
  const H = 210;
  const pad = { l: 44, r: 12, t: 12, b: 26 };

  const pts = row.strikes
    .map((s, i) => ({ s, c: row.call_iv[i], p: row.put_iv[i] }))
    .filter((p) => p.c != null || p.p != null);
  if (pts.length < 2) return <div className="p-6 text-center text-xs text-slate-500">Too few strikes for this expiry</div>;

  const allIv = pts.flatMap((p) => [p.c, p.p].filter((v): v is number => v != null));
  const yMin = Math.min(...allIv) * 0.9;
  const yMax = Math.max(...allIv) * 1.1;
  const sMin = pts[0].s;
  const sMax = pts[pts.length - 1].s;
  const x = (s: number) => pad.l + ((s - sMin) / (sMax - sMin || 1)) * (W - pad.l - pad.r);
  const y = (iv: number) => pad.t + (1 - (iv - yMin) / (yMax - yMin || 1)) * (H - pad.t - pad.b);
  const line = (vals: (number | null)[], color: string) =>
    pts
      .map((p, i) => (vals[i] != null ? `${i === 0 ? "M" : "L"}${x(p.s).toFixed(1)},${y(vals[i] as number).toFixed(1)}` : ""))
      .filter(Boolean)
      .join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0.25, 0.5, 0.75, 1].map((f) => {
        const yy = pad.t + f * (H - pad.t - pad.b);
        return <line key={f} x1={pad.l} x2={W - pad.r} y1={yy} y2={yy} stroke="rgba(255,255,255,0.05)" />;
      })}
      {/* spot reference */}
      {spot != null && spot >= sMin && spot <= sMax && (
        <line x1={x(spot)} x2={x(spot)} y1={pad.t} y2={H - pad.b} stroke="rgba(245,158,11,0.35)" strokeDasharray="3 3" />
      )}
      <path d={line(row.call_iv, "")} fill="none" stroke="#F87171" strokeWidth={1.8} strokeLinecap="round" />
      <path d={line(row.put_iv, "")} fill="none" stroke="#4ADE80" strokeWidth={1.8} strokeLinecap="round" />
      <text x={W - pad.r} y={pad.t + 10} textAnchor="end" fontSize={9} fill="#F87171" fontFamily="monospace">
        calls
      </text>
      <text x={W - pad.r} y={pad.t + 20} textAnchor="end" fontSize={9} fill="#4ADE80" fontFamily="monospace">
        puts
      </text>
      <text x={pad.l} y={H - 8} fontSize={9} fill="#475569" fontFamily="monospace">
        {sMin.toFixed(0)}
      </text>
      <text x={x(spot ?? sMin)} y={H - 8} textAnchor="middle" fontSize={9} fill="#F59E0B" fontFamily="monospace">
        {spot != null ? `spot ${spot.toFixed(1)}` : ""}
      </text>
      <text x={W - pad.r} y={H - 8} textAnchor="end" fontSize={9} fill="#475569" fontFamily="monospace">
        {sMax.toFixed(0)}
      </text>
    </svg>
  );
}

function EmptyCard({ label }: { label: string }) {
  return (
    <div className="animate-rise card py-8 text-center">
      <div className="font-mono text-xs text-slate-500">{label}</div>
    </div>
  );
}
