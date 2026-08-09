/**
 * LevelFlip API contract — mirrors the FastAPI Pydantic models verbatim
 * (backend/main.py: GexBar, IOFPayload, AnalystNote, CandleBar, CandlesPayload).
 * Field-for-field parity is a constitutional rule — do not rename without
 * updating the backend models.
 */

export interface GexBar {
  strike: number;
  gex: number;
  oi_calls: number;
  oi_puts: number;
  iv: number;
}

export interface AnalystNote {
  signal: string;
  summary: string;
  provider: string;
  generated_at: string;
}

export interface IOFPayload {
  ticker: string;
  spot_price: number;
  as_of: string;
  call_wall: number;
  put_wall: number;
  gamma_flip: number;
  max_pain: number;
  expected_move: number;
  atm_iv: number;
  net_gex: number;
  regime: string; // "LONG_GAMMA" | "SHORT_GAMMA" — total net GEX sign
  market_state: string; // "open" | "pre_market" | "post_market" | "closed"
  chain_stale: boolean;
  gex_profile: GexBar[];
  analysis: AnalystNote | null;
}

export interface NewsArticle {
  title: string;
  source: string;
  url: string;
  published_at: string;
}

export interface NewsPayload {
  ticker: string;
  articles: NewsArticle[];
}

export interface FlowPrint {
  contract: string;
  type: string; // "CALL" | "PUT"
  strike: number | null;
  expiry: string;
  premium: number;
  price: number | null;
  volume: number | null;
  side: string | null;
  timestamp: string;
}

export interface FlowPayload {
  ticker: string;
  min_premium: number;
  prints: FlowPrint[];
}

export interface CandleBar {
  time: number; // unix seconds (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface CandlesPayload {
  ticker: string;
  interval: string;
  candles: CandleBar[];
}
