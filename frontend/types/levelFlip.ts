/**
 * LevelFlip API contract — mirrors the FastAPI Pydantic models verbatim
 * (backend/main.py: GexBar, IOFPayload, AnalystNote, CandleBar, CandlesPayload,
 * ExpiryGex*, Vol*). Field-for-field parity is a constitutional rule — do not
 * rename without updating the backend models.
 */

export interface GexBar {
  strike: number;
  gex: number;
  oi_calls: number;
  oi_puts: number;
  iv: number;
  dex: number; // dollar delta exposure (dealers), puts counted negative
  vex: number; // dollar vanna exposure per vol point
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
  net_dex: number; // dealer dollar delta exposure
  net_vex: number; // dealer dollar vanna exposure (per vol point)
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
  dte: number | null;
  delta: number | null;
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

export interface ExpiryGexRow {
  expiry: string;
  dte: number;
  strikes: number[];
  gex: number[];
  oi_calls: number[];
  oi_puts: number[];
  iv: number[];
}

export interface ExpiryBreakdownRow {
  bucket: string; // "0DTE" | "WEEKLY" | "MONTHLY" | "LEAPS"
  expiry: string;
  dte: number;
  dollar_gex: number;
  oi_calls: number;
  oi_puts: number;
  pct: number; // share of total dollar GEX
}

export interface ExpiryGexPayload {
  ticker: string;
  spot: number;
  as_of: string;
  breakdown: ExpiryBreakdownRow[];
  expiries: ExpiryGexRow[];
}

export interface VolExpiryRow {
  expiry: string;
  dte: number;
  strikes: number[];
  call_iv: (number | null)[];
  put_iv: (number | null)[];
  delta: (number | null)[];
  gamma: (number | null)[];
  vega: (number | null)[];
  atm_iv: number | null;
  atm_strike: number | null;
  skew_25: number | null; // 25Δ put IV − 25Δ call IV
}

export interface VolTermPoint {
  expiry: string;
  dte: number;
  atm_iv: number | null;
  skew_25: number | null;
}

export interface VolSignals {
  hv30: number | null;
  iv_hv_premium: number | null; // atm_iv / hv30 − 1
  term_shape: string; // "BACKWARDATION" | "CONTANGO" | "FLAT"
  skew_stress: string; // "PUT_SKEW_STRESS" | "CALL_SKEW_STRESS" | "NEUTRAL_SKEW"
  vol_regime: string; // "EXPENSIVE" | "CHEAP" | "FAIR"
}

export interface VolPayload {
  ticker: string;
  spot: number | null;
  as_of: string;
  source: string;
  expiries: VolExpiryRow[];
  term_structure: VolTermPoint[];
  signals: VolSignals;
}
