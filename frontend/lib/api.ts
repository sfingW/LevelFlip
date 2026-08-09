import useSWR from "swr";
import type { CandlesPayload, IOFPayload } from "@/types/levelFlip";

/** Override with NEXT_PUBLIC_API_URL if the backend is not on localhost:8000. */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`LevelFlip API ${res.status}: ${url}`);
  }
  return (await res.json()) as T;
}

/** Full LevelFlip payload — 2s auto-polling, focus revalidation, dedup. */
export function useIOFData(ticker: string) {
  return useSWR<IOFPayload>(
    `${API_BASE}/api/v1/iof?ticker=${encodeURIComponent(ticker)}`,
    fetcher,
    {
      refreshInterval: 2000,
      dedupingInterval: 2000,
      revalidateOnFocus: true,
      errorRetryCount: 3,
      keepPreviousData: true,
    }
  );
}

/** 1-minute OHLC candles for the chart canvas — refreshed every 30s. */
export function useCandles(ticker: string) {
  return useSWR<CandlesPayload>(
    `${API_BASE}/api/v1/candles?ticker=${encodeURIComponent(ticker)}&interval=1m&period=1d`,
    fetcher,
    {
      refreshInterval: 30_000,
      revalidateOnFocus: false,
      errorRetryCount: 3,
    }
  );
}

export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return "--";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatBig(value: number): string {
  if (!Number.isFinite(value)) return "--";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}
