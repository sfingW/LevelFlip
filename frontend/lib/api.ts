import useSWR from "swr";
import type {
  ExpiryGexPayload,
  FlowPayload,
  IOFPayload,
  NewsPayload,
  VolPayload,
} from "@/types/levelFlip";

/** Override with NEXT_PUBLIC_API_URL if the backend is not on localhost:8000. */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * Static key for the backend's X-API-Key gate. Browser-exposed by design —
 * it is a throttle key (shared 60/min bucket), not a vault. Without it every
 * API call 401s. Set NEXT_PUBLIC_LEVELFLIP_API_KEY in frontend/.env.local.
 */
const API_KEY = process.env.NEXT_PUBLIC_LEVELFLIP_API_KEY ?? "";

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    headers: API_KEY ? { "X-API-Key": API_KEY } : undefined,
  });
  if (!res.ok) {
    throw new Error(`LevelFlip API ${res.status}: ${url}`);
  }
  return (await res.json()) as T;
}

/** Full LevelFlip payload — auto-polling, focus revalidation, dedup. */
export function useIOFData(ticker: string, refreshMs = 2000) {
  return useSWR<IOFPayload>(
    `${API_BASE}/api/v1/iof?ticker=${encodeURIComponent(ticker)}`,
    fetcher,
    {
      refreshInterval: refreshMs,
      dedupingInterval: refreshMs,
      revalidateOnFocus: true,
      errorRetryCount: 3,
      keepPreviousData: true,
    }
  );
}

/** One-minute market snapshot for lightweight pages (homepage). */
export function useMarketSnapshot(ticker = "SPY") {
  return useIOFData(ticker, 60_000);
}

/** Headline feed — ticker-scoped, or the broad market feed when omitted. */
export function useNewsData(ticker?: string, refreshMs = 60_000) {
  const qs = ticker ? `?ticker=${encodeURIComponent(ticker)}` : "";
  return useSWR<NewsPayload>(`${API_BASE}/api/v1/news${qs}`, fetcher, {
    refreshInterval: refreshMs,
    revalidateOnFocus: true,
    errorRetryCount: 2,
  });
}

/** Options-flow prints — slow poll, degrades to a 502 (LSE feed down). */
export function useFlowData(ticker: string, minPremium = 100_000, refreshMs = 30_000) {
  const qs = `?ticker=${encodeURIComponent(ticker)}&min_premium=${minPremium}`;
  return useSWR<FlowPayload>(`${API_BASE}/api/v1/flow${qs}`, fetcher, {
    refreshInterval: refreshMs,
    revalidateOnFocus: true,
    errorRetryCount: 2,
  });
}

/** Per-expiry GEX heatmap + 0DTE/Weekly/Monthly breakdown — 30s poll. */
export function useExpiryGex(ticker: string, refreshMs = 30_000) {
  return useSWR<ExpiryGexPayload>(
    `${API_BASE}/api/v1/expiry_gex?ticker=${encodeURIComponent(ticker)}`,
    fetcher,
    {
      refreshInterval: refreshMs,
      revalidateOnFocus: true,
      errorRetryCount: 2,
      keepPreviousData: true,
    }
  );
}

/** IV surface (smiles + term structure + signals) — 5-min poll (300s backend cache). */
export function useVolData(ticker: string, refreshMs = 300_000) {
  return useSWR<VolPayload>(
    `${API_BASE}/api/v1/vol?ticker=${encodeURIComponent(ticker)}`,
    fetcher,
    {
      refreshInterval: refreshMs,
      revalidateOnFocus: true,
      errorRetryCount: 2,
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
