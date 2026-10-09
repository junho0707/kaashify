// Pro data from Kalshi's public API: leg updates for the alerts poll, and readable names for traded markets.

import type { Cache } from "../../lib/cache.ts";
import { type ApiMarket, type EventInfo, SETTLED, countRequests, getEvents, getMarkets, getMilestones, needsMilestone, outcomeOf, sideProb, stateOf } from "../../lib/kalshi.ts";
import { pickLabel } from "../../lib/markets.ts";
import type { Schedule, Side } from "../../lib/types.ts";

/**
 * Re-reads the public market of each pending leg (price, result, live status) without fetching positions.
 * Used by the alerts poll; costs about one request per 50 legs plus one per date-only game near now.
 */
export async function updateLegs(schedule: Schedule, cache: Cache): Promise<Schedule & { legsAt: number }> {
  const count = countRequests();
  const items = structuredClone(schedule.items);
  const open = items.filter((it) => it.state === "alive" || it.state === "pending");
  const pending = open.flatMap((it) => it.legs.filter((l) => l.outcome === "pending"));
  const markets = await getMarkets(pending.map((l) => l.ticker));
  const ms = await getMilestones(pending.filter((l) => needsMilestone(l.eventTicker)).map((l) => l.eventTicker), cache);
  for (const it of open) {
    for (const l of it.legs) {
      const m = markets.get(l.ticker);
      if (!m || l.outcome !== "pending") continue;
      l.outcome = SETTLED.has(m.status ?? "") || m.result ? outcomeOf(m, l.side) : "pending";
      l.prob = l.outcome === "pending" ? sideProb(m, l.side) : null;
      l.phase = l.outcome === "pending" ? ms.get(l.eventTicker)?.phase ?? null : null;
      l.start ??= ms.get(l.eventTicker)?.start ?? null;
    }
    it.state = stateOf(it);
  }
  return { ...schedule, items, legsAt: Date.now(), requests: count() };
}

/** A traded market as the trade table shows it; combos list their legs with results. */
export interface TradeInfo {
  event: string;
  pick: string;
  legs?: { event: string; pick: string; market_ticker: string; side: Side; result: string }[];
}

/**
 * Readable names for traded markets ("LAD vs ATL: Los Angeles D"), and for combos their legs with results.
 * Settled markets never change, so finished lookups are cached (`ti2:` keys); unfinished ones are fetched again.
 */
export async function tradeInfo(tickers: string[], cache: Cache): Promise<{ info: Record<string, TradeInfo>; requests: number }> {
  const count = countRequests();
  const todo = [...new Set(tickers)].filter((t) => !cache.has(`ti2:${t}`));
  const markets = await getMarkets(todo);
  const legTickers = [...markets.values()].flatMap((m) => (m.mve_selected_legs || []).map((l) => l.market_ticker));
  const legs = await getMarkets(legTickers.filter((x) => !markets.has(x)));
  for (const [k, v] of markets) legs.set(k, v);
  const eventOf = (m: ApiMarket | undefined, t: string) => m?.event_ticker || t.replace(/-[^-]+$/, "");
  await getEvents([...todo.map((t) => eventOf(markets.get(t), t)), ...legTickers.map((t) => eventOf(legs.get(t), t))], cache);
  const name = (t: string, m: ApiMarket | undefined) => {
    const ev = cache.get<EventInfo>(`ev:${eventOf(m, t)}`);
    return { event: (ev?.sub || ev?.title || eventOf(m, t)).replace(/\s*\([^)]*\)\s*$/, ""),
      pick: pickLabel(ev?.series || eventOf(m, t).split("-")[0], m?.yes_sub_title || m?.title || t) };
  };
  const fresh = new Map<string, TradeInfo>();
  for (const t of todo) {
    const m = markets.get(t);
    if (!m) continue;
    const info: TradeInfo = name(t, m);
    if (m.mve_selected_legs?.length) {
      info.legs = m.mve_selected_legs.map((l) => ({ ...name(l.market_ticker, legs.get(l.market_ticker)), market_ticker: l.market_ticker,
        side: l.side || "yes", result: legs.get(l.market_ticker)?.result || "" }));
    }
    const done = SETTLED.has(m.status ?? "") && (!info.legs || info.legs.every((l) => l.result));
    if (done) cache.set(`ti2:${t}`, info);
    else fresh.set(t, info);
  }
  const info: Record<string, TradeInfo> = {};
  for (const t of new Set(tickers)) {
    const i = fresh.get(t) ?? cache.get<TradeInfo>(`ti2:${t}`);
    if (i) info[t] = i;
  }
  return { info, requests: count() };
}
