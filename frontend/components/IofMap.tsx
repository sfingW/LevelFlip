"use client";

import { useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { formatBig, formatDelta, formatPrice, formatSigma } from "@/lib/api";
import type { IOFPayload } from "@/types/levelFlip";

interface IofMapProps {
  data: IOFPayload | undefined;
}

/* SVG canvas — strike on Y (low at the bottom), GEX value on X. */
const W = 1000;
const H = 460;
const PAD_TOP = 30;
const PAD_BOTTOM = 34;
const PAD_LEFT = 52; // left rail: strike ruler
const PAD_RIGHT = 14;
const CHART_W = W - PAD_LEFT - PAD_RIGHT;
const CX = PAD_LEFT + CHART_W / 2; // zero-GEX line
const MAX_BARS = 44;

const C = {
  positive: "#22C55E",
  positiveBright: "#86EFAC",
  positiveDeep: "#16A34A",
  negative: "#EF4444",
  negativeBright: "#FCA5A5",
  negativeDeep: "#B91C1C",
  callWall: "#EF4444",
  putWall: "#22C55E",
  flip: "#F59E0B",
  maxPain: "#A78BFA",
  spot: "#38BDF8",
  em: "#38BDF8",
  grid: "#334155",
  tick: "#64748B",
};

const MONO = "var(--font-mono), ui-monospace, monospace";

/**
 * IOF Battle Map — the whole dealer story in one glance:
 * GEX histogram by strike (2.5D prism bars), ±1σ expected-move band, the four
 * structural hairlines (call wall / levelflip / max pain / put wall), live
 * spot with pulse, and the dealer regime banner. Fully interactive: hover a
 * bar for the strike's full book (GEX / OI / IV / delta vs spot).
 * Custom-rendered SVG: no chart lib, no WebGL.
 */
export default function IofMap({ data }: IofMapProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [hoveredStrike, setHoveredStrike] = useState<number | null>(null);
  const [tip, setTip] = useState<{ left: number; top: number } | null>(null);

  const model = useMemo(() => {
    if (!data) return null;
    const spot = data.spot_price;
    const window = Math.max(spot * 0.05, data.expected_move * 1.5);
    const filtered = data.gex_profile.filter((b) => Math.abs(b.strike - spot) <= window);
    const step = Math.max(1, Math.ceil(filtered.length / MAX_BARS));
    const bars = filtered
      .filter((_, i) => i % step === 0)
      .sort((a, b) => a.strike - b.strike);
    if (!bars.length) return null;

    const kMin = bars[0].strike;
    const kMax = bars[bars.length - 1].strike;
    const span = Math.max(kMax - kMin, 1e-9);
    const maxAbs = Math.max(...bars.map((b) => Math.abs(b.gex)), 1);
    const y = (k: number) => PAD_TOP + ((kMax - k) / span) * (H - PAD_TOP - PAD_BOTTOM);
    const clampY = (k: number) => Math.min(Math.max(y(k), PAD_TOP), H - PAD_BOTTOM);
    return { spot, bars, maxAbs, y, clampY, halfStep: span / bars.length / 2, span, kMin, kMax };
  }, [data]);

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    const box = boxRef.current;
    if (!svg || !box || !model) return;
    const rect = svg.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) * W) / rect.width;
    const sy = ((e.clientY - rect.top) * H) / rect.height;
    const k = model.kMax - ((sy - PAD_TOP) * model.span) / (H - PAD_TOP - PAD_BOTTOM);

    let best = model.bars[0].strike;
    let bestD = Infinity;
    for (const b of model.bars) {
      const d = Math.abs(b.strike - k);
      if (d < bestD) {
        bestD = d;
        best = b.strike;
      }
    }
    setHoveredStrike((prev) => (prev === best ? prev : best));

    const boxRect = box.getBoundingClientRect();
    setTip({
      left: Math.min(e.clientX - boxRect.left + 14, boxRect.width - 184),
      top: Math.max(e.clientY - boxRect.top - 96, 6),
    });
  };

  const onLeave = () => {
    setHoveredStrike(null);
    setTip(null);
  };

  if (!model) {
    return (
      <div className="card h-[460px]">
        <div className="h-full w-full animate-pulse rounded-xl bg-white/[0.03]" />
      </div>
    );
  }

  const { spot, bars, maxAbs, y, clampY, halfStep, span, kMin, kMax } = model;
  const d = data!;
  const longGamma = d.regime === "LONG_GAMMA";
  const hovered = hoveredStrike === null ? undefined : bars.find((b) => b.strike === hoveredStrike);
  const peak = bars.reduce((a, b) => (Math.abs(b.gex) > Math.abs(a.gex) ? b : a));

  const levels = [
    { key: "call_wall", label: "Call Wall", k: d.call_wall, color: C.callWall },
    { key: "flip", label: "LevelFlip", k: d.gamma_flip, color: C.flip },
    { key: "max_pain", label: "Max Pain", k: d.max_pain, color: C.maxPain },
    { key: "put_wall", label: "Put Wall", k: d.put_wall, color: C.putWall },
  ];
  const visible = levels.filter((l) => kMin - halfStep <= l.k && l.k <= kMax + halfStep);

  const rulerStep = Math.max(1, Math.round(bars.length / 7));
  const emHi = spot + d.expected_move;
  const emLo = spot - d.expected_move;

  // 2.5D extrusion: prism gradient body + lighter top cap (the "lit" edge)
  const barOpacity = (strike: number) =>
    hoveredStrike === null ? 0.85 : strike === hoveredStrike ? 1 : 0.35;

  return (
    <div ref={boxRef} className="card relative h-[460px] overflow-hidden">
      {/* header */}
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="level-label">IOF Battle Map</span>
          <span className="rounded border border-edge/70 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-slate-500">
            GEX by strike · 4 expiries
          </span>
        </div>
        <span
          className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest"
          style={{
            color: longGamma ? C.putWall : C.callWall,
            background: longGamma ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)",
          }}
        >
          {longGamma ? "◆ Long gamma — dealers buy dips" : "▼ Short gamma — dealers sell rallies"}
        </span>
      </div>

      {/* right-rail legend */}
      <div className="absolute right-3 top-8 z-10 flex flex-col gap-1 rounded-lg border border-white/[0.07] bg-canvas/80 px-2.5 py-2 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: C.spot, boxShadow: `0 0 6px ${C.spot}` }} />
          <span className="font-mono text-[9px] uppercase tracking-widest text-slate-400">Spot</span>
          <span className="font-mono text-[10px] font-bold tabular-nums text-slate-100">{formatPrice(spot)}</span>
        </div>
        {visible.map((l) => (
          <div key={l.key} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />
            <span className="font-mono text-[9px] uppercase tracking-widest text-slate-400">{l.label}</span>
            <span className="font-mono text-[10px] font-bold tabular-nums" style={{ color: l.color }}>
              {formatPrice(l.k)}
            </span>
            <span className="font-mono text-[9px] tabular-nums text-slate-500">{formatDelta(l.k, spot)}</span>
          </div>
        ))}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="h-[calc(100%-30px)] w-full cursor-crosshair"
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        <defs>
          <linearGradient id="g-pos" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.positiveBright} />
            <stop offset="100%" stopColor={C.positiveDeep} />
          </linearGradient>
          <linearGradient id="g-neg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.negativeBright} />
            <stop offset="100%" stopColor={C.negativeDeep} />
          </linearGradient>
        </defs>

        {/* 1σ expected-move band */}
        <rect
          x={PAD_LEFT}
          y={clampY(emHi)}
          width={CHART_W}
          height={Math.max(clampY(emLo) - clampY(emHi), 2)}
          fill={C.em}
          opacity={0.05}
        />
        <text
          x={PAD_LEFT + 6}
          y={clampY(emHi) + 11}
          fontSize={9}
          fontFamily={MONO}
          fill={C.em}
          opacity={0.75}
        >
          1σ ±{formatPrice(d.expected_move)}
        </text>

        {/* zero-GEX line */}
        <line
          x1={CX}
          y1={PAD_TOP}
          x2={CX}
          y2={H - PAD_BOTTOM}
          stroke={C.grid}
          strokeWidth={1.5}
          strokeDasharray="2 5"
        />

        {/* hovered-strike row band */}
        {hovered && (
          <rect
            x={PAD_LEFT}
            y={clampY(hovered.strike + halfStep)}
            width={CHART_W}
            height={Math.max(clampY(hovered.strike - halfStep) - clampY(hovered.strike + halfStep), 1)}
            fill="#FFFFFF"
            opacity={0.05}
          />
        )}

        {/* GEX bars — 2.5D prism: gradient body + bright top cap */}
        {bars.map((b) => {
          const y0 = clampY(b.strike + halfStep);
          const h = Math.max(clampY(b.strike - halfStep) - y0, 1);
          const len = (Math.abs(b.gex) / maxAbs) * (CHART_W / 2 - 12);
          const pos = b.gex >= 0;
          const x = pos ? CX : CX - Math.max(len, 1);
          const w = Math.max(len, 1);
          const op = barOpacity(b.strike);
          const isPeak = b.strike === peak.strike;
          return (
            <g key={b.strike}>
              <rect
                x={x}
                y={y0}
                width={w}
                height={h}
                rx={2}
                fill={pos ? "url(#g-pos)" : "url(#g-neg)"}
                opacity={op}
                stroke={hoveredStrike === b.strike ? "rgba(255,255,255,0.35)" : "none"}
                strokeWidth={hoveredStrike === b.strike ? 1 : 0}
              >
                <title>{`${formatPrice(b.strike)} — ${formatBig(b.gex)}`}</title>
              </rect>
              {/* extruded top cap (the lit prism edge) */}
              {h > 6 && (
                <rect
                  x={x}
                  y={y0}
                  width={w}
                  height={Math.min(3, h)}
                  rx={1.5}
                  fill={pos ? C.positiveBright : C.negativeBright}
                  opacity={hoveredStrike === null ? 0.9 : hoveredStrike === b.strike ? 1 : 0.4}
                />
              )}
              {/* deepest |GEX| bar gets a breathing highlight */}
              {isPeak && (
                <rect x={x} y={y0} width={w} height={h} rx={2} fill="none" stroke={pos ? C.positiveBright : C.negativeBright} strokeWidth={1} opacity={0.5}>
                  <animate attributeName="opacity" values="0.25;0.7;0.25" dur="2.6s" repeatCount="indefinite" />
                </rect>
              )}
            </g>
          );
        })}

        {/* structural hairlines */}
        {visible.map((l) => {
          const ly = clampY(l.k);
          return (
            <g key={l.key}>
              <line
                x1={PAD_LEFT}
                y1={ly}
                x2={W - PAD_RIGHT}
                y2={ly}
                stroke={l.color}
                strokeWidth={1.5}
                strokeDasharray="7 5"
                opacity={0.8}
              />
            </g>
          );
        })}

        {/* live spot — glow line + pulsing marker */}
        <line x1={PAD_LEFT} y1={clampY(spot)} x2={W - PAD_RIGHT} y2={clampY(spot)} stroke={C.spot} strokeWidth={6} opacity={0.12} />
        <line x1={PAD_LEFT} y1={clampY(spot)} x2={W - PAD_RIGHT} y2={clampY(spot)} stroke={C.spot} strokeWidth={2} />
        <circle cx={CX} cy={clampY(spot)} r={4} fill={C.spot} />
        <circle cx={CX} cy={clampY(spot)} r={4} fill="none" stroke={C.spot} strokeWidth={1.5}>
          <animate attributeName="r" values="4;13;4" dur="1.8s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.7;0;0.7" dur="1.8s" repeatCount="indefinite" />
        </circle>
        <text
          x={PAD_LEFT - 8}
          y={clampY(spot) - 5}
          textAnchor="end"
          fontSize={11}
          fontFamily={MONO}
          fontWeight={800}
          fill={C.spot}
        >
          SPOT {formatPrice(spot)}
        </text>

        {/* strike ruler */}
        {bars.map((b, i) =>
          i % rulerStep === 0 ? (
            <text
              key={b.strike}
              x={PAD_LEFT - 8}
              y={clampY(b.strike) + 3.5}
              textAnchor="end"
              fontSize={9.5}
              fontFamily={MONO}
              fill={C.tick}
              opacity={0.9}
            >
              {formatPrice(b.strike)}
            </text>
          ) : null
        )}
      </svg>

      {/* hover tooltip — the strike's full book */}
      {hovered && tip && (
        <div
          className="pointer-events-none absolute z-20 w-44 rounded-lg border border-white/10 bg-canvas/95 p-2.5 font-mono shadow-2xl backdrop-blur"
          style={{ left: tip.left, top: tip.top }}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-bold tabular-nums text-slate-100">{formatPrice(hovered.strike)}</span>
            <span className="text-[10px] tabular-nums" style={{ color: hovered.gex >= 0 ? C.putWall : C.callWall }}>
              {formatDelta(hovered.strike, spot)}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-widest text-slate-500">GEX</span>
            <span className="text-[11px] font-bold tabular-nums" style={{ color: hovered.gex >= 0 ? C.putWall : C.callWall }}>
              {formatBig(hovered.gex)}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-widest text-slate-500">OI C / P</span>
            <span className="text-[11px] tabular-nums text-slate-300">
              {hovered.oi_calls.toLocaleString()} / {hovered.oi_puts.toLocaleString()}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-widest text-slate-500">IV</span>
            <span className="text-[11px] tabular-nums text-slate-300">{formatSigma(hovered.iv)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
