"use client";

import { useMemo } from "react";
import { formatBig, formatPrice, formatSigma } from "@/lib/api";
import type { IOFPayload } from "@/types/levelFlip";

interface StatStripProps {
  data: IOFPayload | undefined;
}

function Tile({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
      <div className="level-label">{label}</div>
      <div className="mt-0.5 font-mono text-lg font-bold tabular-nums" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="mt-0.5 truncate text-[9px] uppercase tracking-widest text-slate-500">{sub}</div>
    </div>
  );
}

/** Compact desk snapshot — the six numbers that matter, at a glance. */
export default function StatStrip({ data }: StatStripProps) {
  const callGex = useMemo(
    () => (data ? data.gex_profile.reduce((s, b) => s + Math.max(b.gex, 0), 0) : undefined),
    [data]
  );
  const putGex = useMemo(
    () => (data ? data.gex_profile.reduce((s, b) => s + Math.min(b.gex, 0), 0) : undefined),
    [data]
  );

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      <Tile
        label="Net GEX"
        value={data ? formatBig(data.net_gex) : "--"}
        sub="dealer gamma · 1% move"
        color="#38BDF8"
      />
      <Tile
        label="Call GEX"
        value={data ? formatBig(callGex ?? 0) : "--"}
        sub="vol dampening side"
        color="#22C55E"
      />
      <Tile
        label="Put GEX"
        value={data ? formatBig(putGex ?? 0) : "--"}
        sub="vol expansion side"
        color="#EF4444"
      />
      <Tile
        label="Max Pain"
        value={data ? `$${formatPrice(data.max_pain)}` : "--"}
        sub="OPEX pin magnet"
        color="#A78BFA"
      />
      <Tile
        label="1σ Move"
        value={data ? `±$${formatPrice(data.expected_move)}` : "--"}
        sub="expected container"
        color="#38BDF8"
      />
      <Tile
        label="ATM IV"
        value={data ? formatSigma(data.atm_iv) : "--"}
        sub="implied vol · 1σ"
        color="#E2E8F0"
      />
    </div>
  );
}
