// Kalshi data layer: the user's positions and fills from Kalshi's official API (signed with their own API key,
// see auth.ts), plus public market data, assembled into the schedule the calendar draws.

import type { Cache } from "./cache.ts";
import { RateLimitError, kalshiQueue } from "./throttle.ts";
import { marketKind, pickLabel, startFromTicker } from "./markets.ts";
import type { Fill, History, Item, ItemState, Leg, LegOutcome, MarketResult, Position, Schedule, Side } from "./types.ts";

export { marketKind, pickLabel, startFromTicker, RateLimitError };

const BASE = "https://api.elections.kalshi.com/trade-api/v2";
export const SETTLED = new Set(["settled", "finalized", "determined"]);

export class AuthError extends Error {}
export class NoKeyError extends AuthError {}

// --- Raw API shapes (only the fields used) -------------------------------

export interface ApiLegRef { market_ticker: string; event_ticker?: string; side?: Side }
export interface ApiMarket extends MarketResult {
  ticker: string;
  event_ticker?: string;
  title?: string;
  yes_sub_title?: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  last_price_dollars?: string;
  expected_expiration_time?: string;
  occurrence_datetime?: string;
  mve_selected_legs?: ApiLegRef[];
}
export interface EventInfo { title: string; sub: string; series: string; category?: string }
interface Candle { end_period_ts: number; yes_bid?: { close_dollars?: string }; yes_ask?: { close_dollars?: string }; price?: { close_dollars?: string; previous_dollars?: string } }

// --- HTTP -------------------------------------------------------------

let requests = 0; // public API calls in the current run, reported in the refresh log
/** Starts a new count of public API calls; returns a reader for it. */
export function countRequests(): () => number {
  requests = 0;
  return () => requests;
}

/** Nothing may hang a refresh: wraps a promise with a deadline. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([promise, new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error(`${what} timed out`)), ms)))])
    .finally(() => clearTimeout(t));
}

/** Public GET through the shared queue (rate-limited; a 429 is retried there, see throttle.ts). */
export async function publicGet<T>(path: string): Promise<T> {
  const r = await kalshiQueue.run(() => (requests++, fetch(BASE + path, { signal: AbortSignal.timeout(15000) })));
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
  return r.json() as Promise<T>;
}

// --- The user's account (official API, signed GET requests only) ----------------

/** signer(method, path) -> auth headers, or null when no key is set up. Set by the background (or tests). */
type Signer = (method: string, path: string) => Promise<Record<string, string> | null>;
let signer: Signer | null = null;
export const setSigner = (fn: Signer | null) => void (signer = fn);

type Params = Record<string, string | number | null | undefined>;

async function accountGet<T>(path: string, params: Params = {}): Promise<T> {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null).map(([k, v]) => [k, String(v)])).toString();
  const r = await kalshiQueue.run(async () => {
    // Signed per attempt: the timestamp must be fresh after a backoff.
    const headers = signer && (await signer("GET", "/trade-api/v2" + path));
    if (!headers) throw new NoKeyError("Connect your Kalshi API key to load your positions.");
    return fetch(BASE + path + (q ? `?${q}` : ""), { headers, signal: AbortSignal.timeout(20000) });
  });
  if (r.status === 401 || r.status === 403) throw new AuthError(`Kalshi rejected your API key (HTTP ${r.status}). Check the Key ID and private key, or make a new key.`);
  if (!r.ok) throw new Error(`GET ${path} -> HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

/** Cursor pagination: concatenates `key` from every page. */
async function allPagesOf<T>(path: string, key: string, params: Params = {}, max = 50): Promise<T[]> {
  const out: T[] = [], seen = new Set<string>();
  let cursor = "";
  for (let i = 0; i < max; i++) {
    const page = await accountGet<Record<string, unknown>>(path, { ...params, limit: 1000, cursor });
    const items = (page[key] as T[] | undefined) || [];
    out.push(...items);
    cursor = (page.cursor as string) || "";
    if (!cursor || !items.length || seen.has(cursor)) break;
    seen.add(cursor);
  }
  return out;
}

const num = (v: unknown): number => (v == null || v === "" ? NaN : Number(v));
const dollars = (fp: unknown, cents: unknown): number => (Number.isFinite(num(fp)) ? num(fp) : Number.isFinite(num(cents)) ? num(cents) / 100 : NaN);

/** One market position from GET /portfolio/positions. Average price = exposure ÷ contracts. */
export function apiPosition(p: Record<string, unknown> | null | undefined): Position | null {
  const count = num(p?.position_fp ?? p?.position);
  if (!p || typeof p.ticker !== "string" || !Number.isFinite(count) || count === 0) return null;
  const exposure = dollars(p.market_exposure_dollars, p.market_exposure), fees = dollars(p.fees_paid_dollars, p.fees_paid);
  return {
    ticker: p.ticker, count,
    market_exposure_dollars: exposure,
    avg_price: Number.isFinite(exposure) ? exposure / Math.abs(count) : NaN,
    cost: Number.isFinite(exposure) ? exposure + (Number.isFinite(fees) ? fees : 0) : NaN,
    payout: Math.abs(count),
    fees,
    bought_ts: (p.last_updated_ts as string | undefined) ?? null,
  };
}

export async function myPositions(): Promise<Position[]> {
  const raw = await allPagesOf<Record<string, unknown>>("/portfolio/positions", "market_positions", { count_filter: "position", settlement_status: "unsettled" });
  return raw.map(apiPosition).filter((p): p is Position => !!p);
}

/** One fill from GET /portfolio/fills. outcome_side = the side the fill positioned the user for (buy YES / sell NO = yes). */
export function apiFill(f: Record<string, any>): Fill {
  const legacy = f.side && f.action ? (f.action === "buy" ? f.side : f.side === "yes" ? "no" : "yes") : null;
  const yes = (f.outcome_side || (f.book_side ? (f.book_side === "bid" ? "yes" : "no") : legacy)) === "yes";
  const px = yes ? dollars(f.yes_price_dollars, f.yes_price) : dollars(f.no_price_dollars, f.no_price);
  const fill: Fill = { market_ticker: f.ticker || f.market_ticker, is_yes: yes, count_fp: f.count_fp ?? f.count, price_dollars: px,
    fee_dollars: num(f.fee_cost) || 0, create_date: f.created_time || (f.ts ? new Date(f.ts * 1000).toISOString() : null), status: "confirmed" };
  const id = f.fill_id || f.trade_id;
  return id ? { id: String(id), ...fill } : fill;
}

// Fills are fetched again from this far before the newest one already stored, in case some arrived late.
const FILL_OVERLAP_MS = 2 * 864e5;

/**
 * P&L history: the user's fills, plus each traded market's public result (settled results are cached for good).
 * With a previous copy whose fills all have ids, only fills since shortly before its newest one are fetched.
 */
export async function history(cache: Cache, prev?: History | null): Promise<History> {
  requests = 0;
  const incremental = !!prev?.fills.length && prev.fills.every((f) => f.id);
  const since = incremental ? Math.max(...prev!.fills.map((f) => Date.parse(f.create_date))) - FILL_OVERLAP_MS : null;
  const fresh = (await allPagesOf<Record<string, unknown>>("/portfolio/fills", "fills", since ? { min_ts: Math.floor(since / 1000) } : {}))
    .map(apiFill).filter((f) => f.market_ticker && f.create_date);
  let fills = fresh;
  if (incremental) {
    const byId = new Map(prev!.fills.map((f) => [f.id!, f]));
    for (const f of fresh) byId.set(f.id ?? `${f.market_ticker}@${f.create_date}`, f);
    fills = [...byId.values()];
  }
  const tickers = [...new Set(fills.map((f) => f.market_ticker))];
  const markets: Record<string, MarketResult> = {};
  const todo = tickers.filter((t) => !(markets[t] = cache.get<MarketResult>(`mk:${t}`)!));
  const found = await getMarkets(todo);
  // The bulk lookup can skip older markets; ask for those one by one.
  await pool(todo.filter((t) => !found.has(t)), 4, async (t) => {
    try {
      const { market } = await publicGet<{ market?: ApiMarket }>(`/markets/${encodeURIComponent(t)}`);
      if (market) found.set(t, market);
    } catch { /* left out: shown as "not counted" */ }
  });
  for (const [t, m] of found) {
    const slim: MarketResult = { status: m.status, result: m.result || "", settlement_value_dollars: m.settlement_value_dollars ?? null,
      close_time: m.close_time, expiration_time: m.expiration_time, settlement_ts: m.settlement_ts };
    markets[t] = slim;
    if (slim.result === "yes" || slim.result === "no" || slim.result === "scalar") cache.set(`mk:${t}`, slim);
  }
  for (const t of tickers) if (!markets[t]) delete markets[t];
  return { at: Date.now(), fills, markets, requests };
}

/** Cheap signed request to check a newly entered key. */
export const checkKey = () => accountGet("/portfolio/balance");

export async function getMarkets(tickers: string[]): Promise<Map<string, ApiMarket>> {
  const map = new Map<string, ApiMarket>();
  const uniq = [...new Set(tickers)];
  for (let i = 0; i < uniq.length; i += 50) {
    const chunk = uniq.slice(i, i + 50);
    const { markets = [] } = await publicGet<{ markets?: ApiMarket[] }>(`/markets?limit=1000&tickers=${chunk.map(encodeURIComponent).join(",")}`);
    for (const m of markets) map.set(m.ticker, m);
  }
  return map;
}

export async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

/** Event titles ("LAD vs ATL (Oct 7)") never change, so they're cached across refreshes. */
export async function getEvents(eventTickers: string[], cache: Cache): Promise<void> {
  const todo = [...new Set(eventTickers)].filter((t) => !cache.has(`ev:${t}`));
  await pool(todo, 6, async (t) => {
    try {
      const { event } = await publicGet<{ event: { title: string; sub_title?: string; series_ticker: string; category?: string } }>(`/events/${encodeURIComponent(t)}`);
      cache.set(`ev:${t}`, { title: event.title, sub: event.sub_title || "", series: event.series_ticker, category: event.category } satisfies EventInfo);
    } catch {
      cache.set(`ev:${t}`, { title: t, sub: "", series: t.split("-")[0] } satisfies EventInfo);
    }
  });
}

// Kalshi "milestones" carry a real start time and a game status. Used for games whose ticker has only a date
// (tennis, soccer) and for timed games that started in the last day. One request per event (the API ignores
// comma lists). Start times are cached; status is re-read each refresh only for games near now.
// Status codes differ by data feed ("live", "P", "Match in Progress - ...", "CO", "finished"), so they're
// classified loosely; anything unknown is null and the calendar falls back to the start time.
// "unplayed" is NOT finished: the esports feed reports games in progress as "unplayed" until they end.
const LIVE_STATUS = /^(live|inprogress|in_progress|in progress|p|playing|interrupted|suspended)$|in progress/i;
const DONE_STATUS = /^(closed|ended|finished|complete|completed|co|w|wo|wov|ret|retired|cancell?ed|postponed|abandoned)$|complete|closed/i;
export const phaseOf = (status: string | null | undefined): "live" | "done" | null =>
  status == null ? null : LIVE_STATUS.test(status) ? "live" : DONE_STATUS.test(status) ? "done" : null;

export interface Milestone { start: number | null; phase?: "live" | "done" | null }

export async function getMilestones(eventTickers: string[], cache: Cache, now = Date.now()): Promise<Map<string, Milestone>> {
  const out = new Map<string, Milestone>();
  const todo = [...new Set(eventTickers)].filter((e) => {
    const c = cache.get<Milestone>(`ms:${e}`);
    return !c || (c.start != null && Math.abs(c.start - now) < 18 * 3600e3);
  });
  await pool(todo, 6, async (e) => {
    try {
      const { milestones = [] } = await publicGet<{ milestones?: { start_date?: string; details?: { status?: string } }[] }>(
        `/milestones?limit=5&related_event_ticker=${encodeURIComponent(e)}`);
      const m = milestones.find((x) => x.start_date) ?? null;
      cache.set(`ms:${e}`, { start: m ? Date.parse(m.start_date!) : null });
      if (m) out.set(e, { start: null, phase: phaseOf(m.details?.status) });
    } catch { /* no milestone: the calendar uses the ticker time */ }
  });
  for (const e of eventTickers) out.set(e, { ...out.get(e), start: cache.get<Milestone>(`ms:${e}`)?.start ?? null });
  return out;
}

/** Legs worth a milestone lookup: no start time in the ticker, or started within the last day. */
export function needsMilestone(eventTicker: string, now = Date.now()): boolean {
  const ts = startFromTicker(eventTicker)?.ts;
  return ts == null || (ts <= now && now - ts < 24 * 3600e3);
}

const t = (s: string | undefined | null): number | null => (s ? Date.parse(s) : null);

// --- Assembly ---------------------------------------------------------

/**
 * Each leg's market-implied chance at the minute the user bought (Kalshi only stores the combo's price).
 * Uses public 1-minute candles; results never change, so they're cached.
 */
async function legOddsAt(legs: ApiLegRef[], ts: number, cache: Cache): Promise<(number | null)[]> {
  const key = (l: ApiLegRef) => `buy:${l.market_ticker}@${ts}`;
  const todo = legs.filter((l) => !cache.has(key(l)));
  if (todo.length) {
    const end = Math.floor(ts / 1000) + 60, start = end - 30 * 60;
    try {
      const q = `market_tickers=${todo.map((l) => encodeURIComponent(l.market_ticker)).join(",")}&start_ts=${start}&end_ts=${end}&period_interval=1`;
      const { markets = [] } = await publicGet<{ markets?: { market_ticker?: string; ticker?: string; candlesticks?: Candle[] }[] }>(`/markets/candlesticks?${q}`);
      const byTicker = new Map(markets.map((m) => [m.market_ticker ?? m.ticker, m.candlesticks || []]));
      todo.forEach((l, i) => {
        const candles = byTicker.get(l.market_ticker) ?? markets[i]?.candlesticks ?? [];
        const c = candles.filter((x) => x.end_period_ts <= end).at(-1);
        const bid = Number(c?.yes_bid?.close_dollars), ask = Number(c?.yes_ask?.close_dollars);
        const last = Number(c?.price?.close_dollars ?? c?.price?.previous_dollars);
        cache.set(key(l), bid > 0 && ask > 0 && ask < 1 ? (bid + ask) / 2 : last > 0 ? last : null);
      });
    } catch { /* optional detail */ }
  }
  return legs.map((l) => {
    const yes = cache.get<number | null>(key(l));
    return yes == null ? null : (l.side || "yes") === "no" ? 1 - yes : yes;
  });
}

/** Current market-implied chance of this side hitting: bid/ask midpoint, else last trade. */
export function sideProb(m: ApiMarket | undefined, side: Side): number | null {
  if (!m) return null;
  const bid = Number(m.yes_bid_dollars), ask = Number(m.yes_ask_dollars), last = Number(m.last_price_dollars);
  const yes = bid > 0 && ask > 0 && ask < 1 ? (bid + ask) / 2 : last > 0 ? last : null;
  return yes == null ? null : side === "no" ? 1 - yes : yes;
}

export function outcomeOf(m: ApiMarket | undefined, side: Side): LegOutcome {
  if (!m || !(m.result === "yes" || m.result === "no")) return "pending";
  return m.result === side ? "won" : "lost";
}

function buildLeg(ticker: string, side: Side, market: ApiMarket | undefined, ev: EventInfo | undefined,
  fallbackEnd: number | null, ms: Milestone | undefined): Leg {
  const eventTicker = market?.event_ticker || ticker.replace(/-[^-]+$/, "");
  const startTs = startFromTicker(eventTicker)?.ts ?? ms?.start ?? null;
  const end = (startTs == null && fallbackEnd) || t(market?.expected_expiration_time) || t(market?.occurrence_datetime) || t(market?.close_time);
  const settled = !!market && (SETTLED.has(market.status ?? "") || market.result === "yes" || market.result === "no");
  const outcome: LegOutcome = settled && market!.result ? (market!.result === side ? "won" : "lost") : "pending";
  return {
    ticker, eventTicker, side,
    prob: outcome === "pending" ? sideProb(market, side) : null,
    series: ev?.series || eventTicker.split("-")[0],
    category: ev?.category || null, // Kalshi's own event category ("Sports", "Politics", …)
    title: pickLabel(ev?.series || eventTicker.split("-")[0], market?.yes_sub_title || market?.title || ticker),
    eventTitle: ev?.title || eventTicker,
    eventSub: ev?.sub || "",
    start: startTs,
    phase: outcome === "pending" ? ms?.phase ?? null : null,
    end: end || null,
    outcome,
  };
}

export const stateOf = (it: { isCombo: boolean; legs: Leg[] }): ItemState => {
  if (!it.isCombo) return it.legs[0].outcome;
  return it.legs.some((l) => l.outcome === "lost") ? "busted" : it.legs.every((l) => l.outcome === "won") ? "hit" : "alive";
};

/** Builds the calendar's schedule from positions (from myPositions() or a stored copy) and public market data. */
export async function loadSchedule(cache: Cache, positions: Position[]): Promise<Schedule> {
  requests = 0;
  // Fewer requests: a combo's legs never change and a settled leg's market is final, so both are cached; the
  // positions and the open legs of combos seen before go in one /markets call.
  const settledLeg = (x: string) => cache.get<ApiMarket>(`lg:${x}`);
  const knownLegs = positions.flatMap((p) => cache.get<ApiLegRef[]>(`mve:${p.ticker}`) ?? []).map((l) => l.market_ticker);
  const fetched = await getMarkets([...positions.map((p) => p.ticker), ...knownLegs.filter((x) => !settledLeg(x))]);
  const markets = new Map(positions.flatMap((p) => (fetched.has(p.ticker) ? [[p.ticker, fetched.get(p.ticker)!] as const] : [])));

  const legsOf = new Map<string, ApiLegRef[]>();
  const comboEnd = new Map<string, number | null>();
  const legRefs: string[] = [];
  for (const p of positions) {
    const m = markets.get(p.ticker);
    // A combo's own expected result time is real; date-only legs (tennis, soccer) fall back to it.
    const isCombo = !!m?.mve_selected_legs?.length;
    if (isCombo && !cache.has(`mve:${p.ticker}`)) cache.set(`mve:${p.ticker}`, m!.mve_selected_legs);
    comboEnd.set(p.ticker, isCombo ? t(m!.expected_expiration_time) : null);
    const legs = isCombo ? m!.mve_selected_legs! : [{ market_ticker: p.ticker, event_ticker: m?.event_ticker, side: "yes" as Side }];
    legsOf.set(p.ticker, legs);
    legRefs.push(...legs.map((l) => l.market_ticker));
  }
  const legMarkets = await getMarkets(legRefs.filter((x) => !fetched.has(x) && !settledLeg(x)));
  for (const [k, v] of fetched) legMarkets.set(k, v);
  for (const x of legRefs) {
    const m = legMarkets.get(x) ?? settledLeg(x);
    if (!m) continue;
    legMarkets.set(x, m);
    if (SETTLED.has(m.status ?? "") && (m.result === "yes" || m.result === "no") && !settledLeg(x)) {
      cache.set(`lg:${x}`, { ticker: m.ticker, event_ticker: m.event_ticker, title: m.title, yes_sub_title: m.yes_sub_title, status: m.status,
        result: m.result, expected_expiration_time: m.expected_expiration_time, occurrence_datetime: m.occurrence_datetime, close_time: m.close_time } satisfies ApiMarket);
    }
  }
  const legEvent = (x: string) => legMarkets.get(x)?.event_ticker || x.replace(/-[^-]+$/, "");
  await getEvents(legRefs.map(legEvent), cache);
  const lookups = legRefs.filter((x) => !SETTLED.has(legMarkets.get(x)?.status ?? "") && needsMilestone(legEvent(x)));
  const milestones = await getMilestones(lookups.map(legEvent), cache);

  const boughtOdds = new Map<string, (number | null)[]>();
  await pool(positions.filter((p) => p.bought_ts && markets.get(p.ticker)?.mve_selected_legs?.length), 4, async (p) => {
    boughtOdds.set(p.ticker, await legOddsAt(legsOf.get(p.ticker)!, Date.parse(p.bought_ts!), cache));
  });

  const items = positions.map((p): Item => {
    const m = markets.get(p.ticker);
    const isCombo = !!m?.mve_selected_legs?.length;
    const legs = legsOf.get(p.ticker)!.map((l) => {
      const lm = legMarkets.get(l.market_ticker);
      return buildLeg(l.market_ticker, l.side || "yes", lm, cache.get<EventInfo>(`ev:${lm?.event_ticker || l.event_ticker}`),
        comboEnd.get(p.ticker) ?? null, milestones.get(legEvent(l.market_ticker)));
    });
    boughtOdds.get(p.ticker)?.forEach((prob, i) => (legs[i].probAtBuy = prob));
    const userSide: Side = p.count > 0 ? "yes" : "no";
    // For singles the "leg" side is the user's side.
    if (!isCombo) { legs[0].side = userSide; legs[0].outcome = outcomeOf(m, userSide); }
    const ends = legs.map((l) => l.end).filter((x): x is number => !!x);
    return {
      ticker: p.ticker,
      isCombo,
      userSide,
      contracts: Math.abs(p.count),
      exposure: Number(p.market_exposure_dollars ?? 0),
      avgPrice: Number.isFinite(p.avg_price) ? p.avg_price : null,
      cost: Number.isFinite(p.cost) ? p.cost : null,
      fees: Number.isFinite(p.fees) ? p.fees : null,
      payout: Number.isFinite(p.payout) ? p.payout : Math.abs(p.count),
      lastPrice: m?.last_price_dollars != null ? Number(m.last_price_dollars) : null,
      title: isCombo ? `${legs.length}-leg combo` : `${legs[0].eventTitle}: ${legs[0].title}`,
      legs,
      state: stateOf({ isCombo, legs }),
      settleBy: ends.length ? Math.max(...ends) : t(m?.expected_expiration_time) || t(m?.close_time),
      status: m?.status || "unknown",
    };
  });
  return { fetchedAt: Date.now(), items, warnings: [], requests };
}
