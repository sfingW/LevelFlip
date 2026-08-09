"use client";

import { useFlowData } from "@/lib/api";
import { formatBig, formatPrice } from "@/lib/api";

interface FlowPanelProps {
  ticker: string;
}

/**
 * LSE options-flow prints (min premium $100k+). The lane 502s until a valid
 * LSE key is set — the panel then shows a quiet "feed unavailable" state
 * instead of breaking the terminal.
 */
export default function FlowPanel({ ticker }: FlowPanelProps) {
  const { data, isLoading, error } = useFlowData(ticker);

  const unavailable = error?.message.includes("502") ?? false;

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div className="level-label">Options Flow · ≥$100k</div>
        {isLoading && !data && (
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-flip" />
        )}
      </div>

      {unavailable ? (
        <p className="mt-3 rounded-md border border-edge bg-white/[0.03] px-3 py-2.5 text-[11px] leading-relaxed text-slate-500">
          Flow feed unavailable — LSE key not active. Activate{" "}
          <code className="text-slate-400">LSE_API_KEY</code> to light this up.
        </p>
      ) : !data ? (
        <div className="mt-3 space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-white/[0.05]" />
          ))}
        </div>
      ) : data.prints.length === 0 ? (
        <p className="mt-3 text-[11px] text-slate-500">No prints above $100k premium right now.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {data.prints.slice(0, 8).map((p, i) => {
            const isCall = p.type === "CALL";
            return (
              <li
                key={`${p.contract}-${i}`}
                className="flex items-center justify-between gap-2 rounded-md border border-edge bg-white/[0.03] px-2.5 py-1.5 text-[11px]"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[9px] font-black ${
                      isCall ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
                    }`}
                  >
                    {isCall ? "C" : "P"}
                  </span>
                  <span className="truncate font-mono text-slate-300">
                    {p.strike != null ? formatPrice(p.strike) : "—"}
                  </span>
                  <span className="hidden truncate text-slate-500 sm:inline">{p.expiry || "—"}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {p.side && (
                    <span className="uppercase text-slate-500">{p.side}</span>
                  )}
                  <span className="font-mono font-bold tabular-nums text-flip">
                    {formatBig(p.premium)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
