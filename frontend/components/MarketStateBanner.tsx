"use client";

interface MarketStateBannerProps {
  state: string | undefined; // "open" | "pre_market" | "post_market" | "closed"
}

const META: Record<string, { label: string; note: string; cls: string; dot: string }> = {
  open: {
    label: "Market open",
    note: "Live dealer positioning · spot streaming",
    cls: "border-green-500/30 bg-green-500/[0.07] text-green-300",
    dot: "bg-green-400",
  },
  pre_market: {
    label: "Pre-market",
    note: "Session opens 09:30 ET — OI anchor is last close",
    cls: "border-amber-500/30 bg-amber-500/[0.07] text-amber-300",
    dot: "bg-amber-400",
  },
  post_market: {
    label: "Post-market",
    note: "Extended session 16:00–20:00 ET — spot may lag",
    cls: "border-amber-500/30 bg-amber-500/[0.07] text-amber-300",
    dot: "bg-amber-400",
  },
  closed: {
    label: "Market closed",
    note: "Weekend/holiday — showing EOD dealer positioning, updates resume at 09:30 ET",
    cls: "border-slate-500/30 bg-slate-500/[0.08] text-slate-300",
    dot: "bg-slate-400",
  },
};

/** Full-width session-state strip — the "Market Closed" UI state, not a crash. */
export default function MarketStateBanner({ state }: MarketStateBannerProps) {
  if (!state || state === "open") return null;
  const meta = META[state] ?? META.closed;

  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg border px-3.5 py-2 text-xs ${meta.cls}`}
      role="status"
    >
      <span className={`relative flex h-2 w-2 shrink-0`}>
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${meta.dot}`} />
        <span className={`relative inline-flex h-2 w-2 rounded-full ${meta.dot}`} />
      </span>
      <span className="font-bold uppercase tracking-widest">{meta.label}</span>
      <span className="hidden truncate text-slate-400 sm:inline">— {meta.note}</span>
    </div>
  );
}
