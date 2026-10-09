// Shared data shapes: what the background stores and the calendar page reads.

export type Side = "yes" | "no";
export type LegOutcome = "pending" | "won" | "lost";
/** Singles use the leg outcome; combos are alive until a leg loses (busted) or every leg wins (hit). */
export type ItemState = LegOutcome | "alive" | "busted" | "hit";

/** One open position from GET /portfolio/positions. `count` is signed: negative = NO contracts. */
export interface Position {
  ticker: string;
  count: number;
  market_exposure_dollars: number;
  avg_price: number;
  cost: number;
  payout: number;
  fees: number;
  bought_ts: string | null;
}

/** One pick: the whole bet for a single, or one leg of a combo. */
export interface Leg {
  ticker: string;
  eventTicker: string;
  side: Side;
  /** Market-implied chance of this side hitting, now (pending legs only). */
  prob: number | null;
  /** The same chance at the minute the user bought (combos only). */
  probAtBuy?: number | null;
  series: string;
  category: string | null;
  /** The pick with its market type, e.g. "First 5 innings total: Over 6.5 runs". */
  title: string;
  eventTitle: string;
  eventSub: string;
  /** Real start time (from the ticker or Kalshi's milestones), or null. */
  start: number | null;
  /** Kalshi's game status, when it has one. */
  phase: "live" | "done" | null;
  /** Expected result time; the calendar falls back to it when there's no start time. */
  end: number | null;
  outcome: LegOutcome;
}

/** One position as the calendar shows it. */
export interface Item {
  ticker: string;
  isCombo: boolean;
  userSide: Side;
  contracts: number;
  exposure: number;
  /** Dollars per contract paid = implied probability at buy. */
  avgPrice: number | null;
  cost: number | null;
  fees: number | null;
  /** $1 per contract if it hits. */
  payout: number;
  lastPrice: number | null;
  title: string;
  legs: Leg[];
  state: ItemState;
  settleBy: number | null;
  status: string;
}

export interface Schedule {
  fetchedAt: number;
  items: Item[];
  warnings: string[];
  requests: number;
  /** Set when Kalshi couldn't be reached and the last positions were used instead. */
  staleAt?: number | null;
  staleReason?: string | null;
  via?: "api" | "snapshot";
  /** When the last refresh was turned away by Kalshi's rate limit (this is the previous data; a retry is scheduled). */
  rateLimited?: number | null;
}

/** A fill reduced to what the P&L needs. `is_yes` = the fill positioned the user for YES. */
export interface Fill {
  id?: string;
  market_ticker: string;
  is_yes: boolean;
  count_fp: string | number;
  price_dollars: number;
  fee_dollars: number;
  create_date: string;
  status?: string;
}

/** The public facts about a traded market that decide its P&L. */
export interface MarketResult {
  status?: string;
  result?: string;
  settlement_value_dollars?: string | number | null;
  close_time?: string;
  expiration_time?: string;
  settlement_ts?: string;
}

/** Everything the P&L tab needs, as fetched by the background. */
export interface History {
  at: number;
  fills: Fill[];
  markets: Record<string, MarketResult>;
  requests: number;
}

export type TradeResult = "won" | "lost" | "exited";

/** One closed trade (a market the user is out of, or that has settled). */
export interface Trade {
  ticker: string;
  side: Side | string;
  qty: number;
  combo: boolean;
  entry: number;
  exit: number;
  /** Money in (price + fees) and out (payout or sale); present for trades built from fills. */
  in?: number;
  out?: number;
  fees: number;
  closeFees: number;
  pnl: number;
  gross: number;
  openedAt: number | null;
  closedAt: number;
  result: TradeResult;
}

export interface LastError {
  message: string;
  auth: boolean;
  needsKey: boolean;
  debug: boolean;
  at: number;
}

/** Messages the calendar page sends to the background. */
export type Request =
  | { type: "refresh"; interactive?: boolean }
  | { type: "set-key"; keyId: string; pem: string }
  | { type: "remove-key" }
  | { type: "clear" }
  | { type: "pnl-live" }
  | { type: "focus-calendar" };

export type RefreshResult = { ok: true; data: Schedule } | { ok: false; error: Pick<LastError, "message"> & Partial<LastError> };
export type PnlLiveResult = { ok: true; live: History } | { ok: false; auth?: boolean; error: string };
