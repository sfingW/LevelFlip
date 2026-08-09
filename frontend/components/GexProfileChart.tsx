"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatBig, formatPrice } from "@/lib/api";
import type { IOFPayload } from "@/types/levelFlip";

interface GexProfileChartProps {
  data: IOFPayload | undefined;
}

/** Net GEX per strike — +GEX green (vol dampening), -GEX red (vol accelerating). */
export default function GexProfileChart({ data }: GexProfileChartProps) {
  const bars = useMemo(() => {
    if (!data) return [];
    const spot = data.spot_price;
    // lizard-brain readability: ±5% window around spot, capped at ~48 bars
    const window = spot * 0.05;
    const filtered = data.gex_profile.filter((b) => Math.abs(b.strike - spot) <= window);
    const step = Math.max(1, Math.ceil(filtered.length / 48));
    return filtered
      .filter((_, i) => i % step === 0)
      .map((b) => ({ ...b, label: formatPrice(b.strike) }))
      .sort((a, b) => a.strike - b.strike);
  }, [data]);

  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={bars}
          layout="vertical"
          margin={{ top: 4, right: 8, bottom: 0, left: 4 }}
          barCategoryGap="15%"
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            width={64}
            tick={{ fontSize: 10, fill: "#94A3B8" }}
            tickLine={false}
            axisLine={{ stroke: "#334155" }}
          />
          <Tooltip
            cursor={{ fill: "rgba(148,163,184,0.08)" }}
            contentStyle={{
              background: "#1E293B",
              border: "1px solid #334155",
              borderRadius: 8,
              fontSize: 12,
              color: "#E2E8F0",
            }}
            formatter={(value) => [formatBig(Number(value)), "Net GEX"]}
            labelFormatter={(label) => `Strike ${label}`}
          />
          <ReferenceLine x={0} stroke="#475569" />
          <Bar dataKey="gex" isAnimationActive={false} radius={[0, 3, 3, 0]}>
            {bars.map((b) => (
              <Cell key={b.strike} fill={b.gex >= 0 ? "#22C55E" : "#EF4444"} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
