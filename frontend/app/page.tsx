"use client";

import Link from "next/link";
import MarketStateBanner from "@/components/MarketStateBanner";
import NavBar from "@/components/NavBar";
import { BoltIcon } from "@/components/icons";
import { formatBig, formatPrice, useMarketSnapshot, useNewsData } from "@/lib/api";

const QUICK_TICKERS = ["SPY", "QQQ", "NVDA", "ES"];

function timeAgo(iso: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function HomePage() {
  const { data: market } = useMarketSnapshot();
  const { data: news } = useNewsData(undefined, 60_000);

  const longGamma = market ? market.regime === "LONG_GAMMA" : null;

  return (
    <main className="min-h-screen">
      <NavBar />

      {/* hero */}
      <section className="mx-auto flex max-w-[1200px] flex-col items-center px-4 pb-10 pt-14 text-center">
        <div className="flex items-center gap-2 rounded-full border border-edge bg-white/[0.03] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
          <span className="h-1.5 w-1.5 rounded-full bg-flip" />
          Institutional dealer positioning
        </div>

        <h1 className="mt-5 max-w-2xl text-4xl font-black leading-tight tracking-tight text-slate-100 sm:text-5xl">
          See where dealers are{" "}
          <span className="bg-gradient-to-r from-flip via-amber-400 to-orange-500 bg-clip-text text-transparent">
            forced to trade
          </span>
        </h1>

        <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-400">
          LevelFlip maps the options chain to dollar gamma — call walls, put walls, the zero-gamma
          pivot and max pain — so you trade with the dealer's flow, not against it.
        </p>

        {/* CTA + quick tickers */}
        <div className="mt-8 flex flex-col items-center gap-4">
          <Link
            href="/terminal"
            className="animate-glow-amber flex items-center gap-2 rounded-lg bg-flip px-6 py-3 text-sm font-black uppercase tracking-widest text-slate-950 transition hover:brightness-110 active:scale-95"
          >
            <BoltIcon className="h-4 w-4" />
            Launch Terminal
          </Link>

          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-slate-500">Jump to</span>
            {QUICK_TICKERS.map((t) => (
              <Link
                key={t}
                href={`/terminal?ticker=${t}`}
                className="chip"
              >
                {t}
              </Link>
            ))}
          </div>
        </div>

        {/* market snapshot */}
        <div className="mt-10 w-full max-w-md">
          <MarketStateBanner state={market?.market_state} />
          {market && (
            <div className="mt-2 grid grid-cols-4 gap-2 text-left">
              <Snapshot label="SPY" value={market.spot_price ? `$${formatPrice(market.spot_price)}` : "--"} />
              <Snapshot label="Net GEX" value={market.net_gex ? formatBig(market.net_gex) : "--"} />
              <Snapshot label="Flip" value={market.gamma_flip ? `$${formatPrice(market.gamma_flip)}` : "--"} />
              <Snapshot
                label="Regime"
                value={longGamma === null ? "--" : longGamma ? "LONG" : "SHORT"}
                tone={longGamma === null ? undefined : longGamma ? "text-green-400" : "text-red-400"}
              />
            </div>
          )}
        </div>
      </section>

      {/* news feed */}
      <section className="mx-auto max-w-[1200px] px-4 pb-16">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xs font-black uppercase tracking-[0.24em] text-slate-300">
            Market Headlines
          </h2>
          <Link
            href="/terminal"
            className="text-[10px] font-semibold uppercase tracking-widest text-flip hover:text-amber-300"
          >
            Trade the setup →
          </Link>
        </div>

        {!news ? (
          <div className="grid gap-3 md:grid-cols-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="card h-24 animate-pulse bg-white/[0.04]" />
            ))}
          </div>
        ) : news.articles.length === 0 ? (
          <div className="card py-10 text-center text-sm text-slate-500">
            No headlines right now — the tape is quiet.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {news.articles.map((a, i) => (
              <a
                key={`${a.url}-${i}`}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="card group flex flex-col justify-between gap-3 p-4 transition hover:border-flip/40 hover:bg-white/[0.05]"
              >
                <h3 className="line-clamp-3 text-sm font-semibold leading-snug text-slate-200 transition group-hover:text-flip">
                  {a.title}
                </h3>
                <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-slate-500">
                  <span className="truncate">{a.source || "market feed"}</span>
                  <span className="shrink-0 pl-2">{timeAgo(a.published_at)}</span>
                </div>
              </a>
            ))}
          </div>
        )}
      </section>

      <footer className="border-t border-edge py-5 text-center text-[10px] uppercase tracking-widest text-slate-600">
        LevelFlip — dealer gamma positioning · not investment advice
      </footer>
    </main>
  );
}

function Snapshot({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="card px-3 py-2.5">
      <div className="level-label">{label}</div>
      <div className={`mt-0.5 truncate font-mono text-sm font-bold tabular-nums text-slate-100 ${tone ?? ""}`}>
        {value}
      </div>
    </div>
  );
}
