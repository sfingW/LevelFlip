import useSWR from "swr";
import type { IOFPayload } from "@/types/levelFlip";

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

/** IV as a percent string, e.g. 0.1781 -> "17.8%". */
export function formatSigma(iv: number): string {
  if (!Number.isFinite(iv)) return "--";
  return `${(iv * 100).toFixed(1)}%`;
}

/** Signed percent delta vs spot, e.g. +0.27% / -4.90%. */
export function formatDelta(value: number, spot: number | undefined): string | null {
  if (value === undefined || spot === undefined || !Number.isFinite(value) || spot <= 0) {
    return null;
  }
  const d = ((value - spot) / spot) * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(2)}%`;
}
