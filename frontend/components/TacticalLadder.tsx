"use client";

import { formatDelta, formatPrice } from "@/lib/api";
import type { IOFPayload } from "@/types/levelFlip";
import { FlipIcon, PinIcon, RadarIcon, ShieldUpIcon, WallIcon } from "@/components/icons";

interface TacticalLadderProps {
  data: IOFPayload | undefined;
}

/** IOF tactical execution matrix — the five rungs, paper Module 4. */
const RUNG_DEFS = [
  {
    key: "call_wall",
    icon: WallIcon,
    color: "#EF4444",
    label: "Call Wall",
    tactic: "Fade rallies · short-scalp entry · long target",
  },
  {
    key: "gamma_flip",
    icon: FlipIcon,
    color: "#F59E0B",
    label: "LevelFlip",
    tactic: "Hard stop for longs · breakdown trigger",
  },
  {
    key: "max_pain",
    icon: PinIcon,
    color: "#A78BFA",
    label: "Max Pain",
    tactic: "OPEX pin magnet · 4PM theta capture",
  },
  {
    key: "expected_move",
    icon: RadarIcon,
    color: "#38BDF8",
    label: "1σ Move",
    tactic: "Fade statistical extremes · mean-reversion",
  },
  {
    key: "put_wall",
    icon: ShieldUpIcon,
    color: "#22C55E",
    label: "Put Wall",
    tactic: "High-conviction long dip-buy zone",
  },
];

export default function TacticalLadder({ data }: TacticalLadderProps) {
  if (!data) {
    return (
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        {RUNG_DEFS.map((r) => (
          <div key={r.key} className="card h-[104px] animate-pulse" />
        ))}
      </div>
    );
  }

  const spot = data.spot_price;
  const valueFor = (key: string): number | null => {
    switch (key) {
      case "call_wall":
        return data.call_wall;
      case "gamma_flip":
        return data.gamma_flip;
      case "max_pain":
        return data.max_pain;
      case "expected_move":
        return data.expected_move;
      case "put_wall":
        return data.put_wall;
      default:
        return null;
    }
  };

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
      {RUNG_DEFS.map((r) => {
        const Icon = r.icon;
        const value = valueFor(r.key);
        const delta = r.key === "expected_move" ? null : formatDelta(value!, spot);
        return (
          <div key={r.key} className="card group">
            <div className="flex items-center justify-between">
              <span
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-transform group-hover:scale-110"
                style={{ color: r.color, background: `${r.color}14` }}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="font-mono text-[9px] tabular-nums" style={{ color: r.color }}>
                {delta ?? `±${formatPrice(value!)}`}
              </span>
            </div>
            <div className="level-label mt-2" style={{ color: r.color }}>
              {r.label}
            </div>
            <div className="font-mono text-xl font-bold tabular-nums text-slate-100">
              {r.key === "expected_move" ? `±$${formatPrice(value!)}` : `$${formatPrice(value!)}`}
            </div>
            <div className="mt-1 text-[10px] leading-snug text-slate-500">{r.tactic}</div>
          </div>
        );
      })}
    </div>
  );
}
