"use client";

import type { IOFPayload } from "@/types/levelFlip";

interface DeskBriefProps {
  data: IOFPayload | undefined;
}

const SIGNAL_COLORS: Record<string, string> = {
  BULLISH_ABSORPTION: "#22C55E",
  BULLISH_DRIFT: "#22C55E",
  PUT_WALL_SUPPORT: "#22C55E",
  BEARISH_ABSORPTION: "#EF4444",
  BEARISH_PRESSURE: "#EF4444",
  CALL_WALL_RESISTANCE: "#EF4444",
  PINNED: "#F59E0B",
  NEUTRAL: "#94A3B8",
};

/** AI desk briefing — one badge + a 3-line max brief. No walls of text. */
export default function DeskBrief({ data }: DeskBriefProps) {
  const a = data?.analysis;

  return (
    <div className="card flex min-h-[150px] flex-col">
      <div className="flex items-center justify-between">
        <span className="level-label">AI Desk Brief</span>
        {a && (
          <span className="font-mono text-[9px] uppercase tracking-widest text-slate-500">
            {a.provider} ·{" "}
            {a.generated_at ? new Date(a.generated_at).toUTCString().slice(17, 22) : "--"} UTC
          </span>
        )}
      </div>

      {!a ? (
        <div className="flex flex-1 flex-col justify-center gap-2">
          <div className="h-4 w-24 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-3 w-full animate-pulse rounded bg-white/[0.05]" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-white/[0.05]" />
        </div>
      ) : (
        <div className="mt-2.5 flex flex-1 flex-col gap-2">
          <span
            className="w-fit rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest"
            style={{
              color: SIGNAL_COLORS[a.signal] ?? "#94A3B8",
              background: `${SIGNAL_COLORS[a.signal] ?? "#94A3B8"}1A`,
            }}
          >
            {a.signal.replaceAll("_", " ")}
          </span>
          <p
            className="line-clamp-3 text-[13px] leading-relaxed text-slate-300"
            title={a.summary}
          >
            {a.summary}
          </p>
        </div>
      )}
    </div>
  );
}
