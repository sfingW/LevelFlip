"use client";

import { formatPrice } from "@/lib/api";
import type { IOFPayload } from "@/types/levelFlip";

interface MetricCardsProps {
  data: IOFPayload | undefined;
}

interface LevelCardProps {
  label: string;
  caption: string;
  color: string;
  value: number | undefined;
  spot: number | undefined;
}

function LevelCard({ label, caption, color, value, spot }: LevelCardProps) {
  const delta =
    value !== undefined && spot !== undefined && spot > 0
      ? ((value - spot) / spot) * 100
      : null;

  return (
    <div
      className="card relative overflow-hidden"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div className="flex items-center justify-between">
        <span className="level-label" style={{ color }}>
          {label}
        </span>
        {delta !== null && (
          <span className="font-mono text-[10px] tabular-nums" style={{ color }}>
            {delta >= 0 ? "+" : ""}
            {delta.toFixed(2)}%
          </span>
        )}
      </div>
      <div className="level-price" style={{ color }}>
        {value !== undefined ? `$${formatPrice(value)}` : "--"}
      </div>
      <div className="mt-1 text-[9px] uppercase tracking-widest text-slate-500">{caption}</div>
    </div>
  );
}

export default function MetricCards({ data }: MetricCardsProps) {
  const spot = data?.spot_price;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <LevelCard
        label="Call Wall"
        caption="Short-gamma resistance"
        color="#EF4444"
        value={data?.call_wall}
        spot={spot}
      />
      <LevelCard
        label="LevelFlip"
        caption="Zero-gamma pivot"
        color="#F59E0B"
        value={data?.gamma_flip}
        spot={spot}
      />
      <LevelCard
        label="Put Wall"
        caption="Long-gamma support"
        color="#22C55E"
        value={data?.put_wall}
        spot={spot}
      />
    </div>
  );
}
