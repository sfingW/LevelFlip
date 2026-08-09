"use client";

import { useEffect, useRef } from "react";
import { ColorType, LineStyle, createChart } from "lightweight-charts";
import type { ISeriesApi, IPriceLine, UTCTimestamp } from "lightweight-charts";
import type { CandleBar, IOFPayload } from "@/types/levelFlip";

interface TradingViewChartProps {
  candles: CandleBar[] | undefined;
  data: IOFPayload | undefined;
}

const LEVEL_LINES = [
  { key: "call_wall", color: "#EF4444", label: "CALL WALL" },
  { key: "gamma_flip", color: "#F59E0B", label: "FLIP" },
  { key: "put_wall", color: "#22C55E", label: "PUT WALL" },
] as const;

export default function TradingViewChart({ candles, data }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const spotSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const spotTickerRef = useRef<string | null>(null);

  // --- lifecycle: create once, destroy fully on unmount -----------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#94A3B8",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(51,65,85,0.25)" },
        horzLines: { color: "rgba(51,65,85,0.25)" },
      },
      rightPriceScale: { borderColor: "rgba(51,65,85,0.6)" },
      timeScale: { borderColor: "rgba(51,65,85,0.6)", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#22C55E",
      downColor: "#EF4444",
      borderUpColor: "#22C55E",
      borderDownColor: "#EF4444",
      wickUpColor: "#22C55E",
      wickDownColor: "#EF4444",
    });
    const spotSeries = chart.addLineSeries({
      color: "#38BDF8",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      title: "SPOT",
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    spotSeriesRef.current = spotSeries;

    return () => {
      // full teardown: price lines -> series -> chart (cancels the
      // internal ResizeObserver and timers). Safe under StrictMode remount.
      for (const pl of priceLinesRef.current) candleSeries.removePriceLine(pl);
      priceLinesRef.current = [];
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      spotSeriesRef.current = null;
      spotTickerRef.current = null;
    };
  }, []);

  // --- candle data ------------------------------------------------------
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || !candles?.length) return;
    series.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );
  }, [candles]);

  // --- level overlays: red call wall / amber flip / green put wall ------
  useEffect(() => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series || !data) return;

    for (const pl of priceLinesRef.current) series.removePriceLine(pl);
    priceLinesRef.current = LEVEL_LINES.filter((l) => Number.isFinite(data[l.key])).map((l) =>
      series.createPriceLine({
        price: data[l.key],
        color: l.color,
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: l.label,
      })
    );
  }, [data, data?.call_wall, data?.gamma_flip, data?.put_wall]);

  // --- live spot line (one sample per poll, reset on ticker change) -----
  useEffect(() => {
    const series = spotSeriesRef.current;
    if (!series || data?.spot_price === undefined) return;
    if (spotTickerRef.current !== data.ticker) {
      series.setData([]);
      spotTickerRef.current = data.ticker;
    }
    series.update({
      time: Math.floor(Date.now() / 1000) as UTCTimestamp,
      value: data.spot_price,
    });
  }, [data?.spot_price, data?.ticker]);

  return <div ref={containerRef} className="h-full w-full" />;
}
