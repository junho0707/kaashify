// Messages the calendar page sends to the background for paid features (on top of `Request` in lib/types.ts).

import type { TradeInfo } from "./lib/kalshi-pro.ts";

export type ProRequest =
  | { type: "trade-info"; tickers: string[] };

type Fail = { ok: false; error: string };
export type TradeInfoResult = { ok: true; info: Record<string, TradeInfo> } | Fail;
