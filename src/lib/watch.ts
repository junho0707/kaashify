// Market Watcher: the user follows a team, a player, a league or a Kalshi series/event, and sees the next events
// for it with their Kalshi markets. Kalshi-only: an event shows up once Kalshi lists it (Kalshi often lists games
// before their markets open, shown as "no Kalshi market yet"); games Kalshi hasn't listed at all would need
// another data source and aren't shown.
//
// Everything here uses Kalshi's public market data (no API key). Pure matching logic plus the fetch layer, with
// the HTTP calls injectable for tests.

import type { Cache } from "./cache.ts";
import { publicGet, pool } from "./kalshi.ts";
import { startFromTicker } from "./markets.ts";
import { LEAGUES, type League, leagueOf } from "./teams.ts";

export { LEAGUES, leagueOf };

// --- Watch items -------------------------------------------------------

export type WatchItem =
  | { id: string; kind: "league"; league: string; label: string }
  /** A team: by Kalshi code for the big leagues, else by name in event titles (soccer, college). */
  | { id: string; kind: "team"; league: string; code?: string; name: string; label: string }
  /** A player's markets: props, or the match/fight winner in tennis and UFC. */
  | { id: string; kind: "player"; league: string; name: string; label: string }
  | { id: string; kind: "series"; ticker: string; label: string }
  | { id: string; kind: "event"; ticker: string; label: string };

/** Watched items are kept in storage.sync, which has small per-item quotas. */
export const MAX_ITEMS = 40;
/** Upcoming events shown per watched item. */
export const EVENTS_PER_ITEM = 80;   // everything Kalshi has listed (UFC cards go up ~2 weeks ahead)
/** Games that started more than this long ago are over (just not settled yet): hidden. */
export const LIVE_MS = 4 * 3600e3;
/** Markets shown per event (the rest are a link away). */
export const MARKETS_PER_EVENT = 8;

export interface WatchMarket {
  ticker: string;
  label: string;
  yesBid: number | null;
  yesAsk: number | null;
  noBid: number | null;
  noAsk: number | null;
  volume: number;
}
export interface WatchEvent {
  /** Same for every event of one game (e.g. "26OCT08DALBUF"), so a game's winner, totals and props group together. */
  key: string;
  ticker: string;
  series: string;
  title: string;
  sub: string;
  start: number | null;
  /** The time is Kalshi's expected result time, not a real start. */
  approx: boolean;
  url: string;
  markets: WatchMarket[];
  /** Open markets not listed in `markets`. */
  more: number;
}
export interface WatchResult { events: WatchEvent[]; error?: string | null }
export interface WatchResults { at: number; items: Record<string, WatchResult>; requests?: number }

/** [ticker, title, tag] of each Kalshi sports series, for autocomplete. */
export type SeriesEntry = [string, string, string];

/** Messages the page sends the background for the watcher. */
export type WatchRequest = { type: "watch-refresh"; force?: boolean } | { type: "watch-series" };
export type WatchSeriesResult = { ok: true; list: SeriesEntry[] } | { ok: false; error: string };

export const norm = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const TICKER = /^KX[A-Z0-9]+(?:-[A-Z0-9.]+)*$/i;

/** A watch item before it has an id. */
export type WatchDraft = WatchItem extends infer T ? T extends WatchItem ? Omit<T, "id"> : never : never;

export function itemId(i: WatchDraft): string {
  switch (i.kind) {
    case "league": return `league:${i.league}`;
    case "team": return `team:${i.league}:${i.code ?? norm(i.name)}`;
    case "player": return `player:${i.league}:${norm(i.name)}`;
    default: return `${i.kind}:${i.ticker.toUpperCase()}`;
  }
}
const make = (i: WatchDraft): WatchItem => ({ ...i, id: itemId(i) } as WatchItem);

const teamLabel = (l: League, [, city, nick]: [string, string, string]) => `${city === nick ? city : `${city} ${nick}`} (${l.key})`;

/**
 * Autocomplete: leagues, teams, Kalshi series (from the series index) and tickers that match what was typed, then
 * "player" and "team name" searches per league. A league key in the text ("Eichel NHL") narrows to that league.
 */
export function suggest(text: string, series: SeriesEntry[] = [], max = 14): WatchItem[] {
  const raw = text.trim();
  const q = norm(raw);
  if (q.length < 2) return [];
  const out: WatchItem[] = [];
  const add = (i: WatchItem) => { if (!out.some((o) => o.id === i.id)) out.push(i); };
  if (TICKER.test(raw) && /\d|-/.test(raw)) {
    const t = raw.toUpperCase();
    add(make(t.includes("-") ? { kind: "event", ticker: t, label: `Event ${t}` } : { kind: "series", ticker: t, label: `Series ${t}` }));
  }
  const words = q.split(" ");
  const only = LEAGUES.find((l) => words.includes(l.key.toLowerCase()));
  const name = only ? words.filter((w) => w !== only.key.toLowerCase()).join(" ") : q;
  const pretty = only ? raw.split(/\s+/).filter((w) => w.toLowerCase() !== only.key.toLowerCase()).join(" ") : raw;
  const leagues = only ? [only] : LEAGUES;

  for (const l of leagues) {
    if (norm(l.key) === name || norm(l.name).startsWith(name) || (only && !name)) add(make({ kind: "league", league: l.key, label: `${l.name}: next games` }));
  }
  if (name) {
    for (const l of leagues) for (const t of l.teams ?? []) {
      const [code, city, nick] = t;
      const full = norm(`${city} ${nick}`);
      if (norm(nick).startsWith(name) || full.includes(name) || norm(code) === name || norm(city) === name) {
        add(make({ kind: "team", league: l.key, code, name: `${city} ${nick}`, label: teamLabel(l, t) }));
      }
    }
    for (const [ticker, title] of series) {
      if (out.length >= max) break;
      if (norm(title).includes(name) || ticker.toLowerCase() === name || ticker.toLowerCase() === `kx${name}`) {
        add(make({ kind: "series", ticker, label: `${title} (${ticker})` }));
      }
    }
  }
  // Free text, unless it named a known team ("Rangers"): a search per league.
  if (name.length >= 3 && !out.some((o) => o.kind === "team")) {
    // Free text: a person ("Jack Eichel") reads as a player first; a single word as a team name first.
    const people = leagues.filter((l) => l.props.length)
      .map((l) => make({ kind: "player", league: l.key, name: pretty, label: `${pretty}: player markets (${l.key})` }));
    const named = leagues.filter((l) => !l.teams && l.props.join() !== l.game.join())
      .map((l) => make({ kind: "team", league: l.key, name: pretty, label: `${pretty}: games (${l.name})` }));
    for (const i of name.includes(" ") ? [...people, ...named] : [...named, ...people]) add(i);
  }
  return out.slice(0, max);
}

// --- Matching Kalshi events --------------------------------------------

export interface ApiWatchMarket {
  ticker: string;
  event_ticker?: string;
  title?: string;
  yes_sub_title?: string;
  status?: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  no_bid_dollars?: string;
  no_ask_dollars?: string;
  volume_fp?: string;
  volume?: number;
  occurrence_datetime?: string;
  expected_expiration_time?: string;
}
export interface ApiEvent {
  event_ticker: string;
  series_ticker?: string;
  title?: string;
  sub_title?: string;
  markets?: ApiWatchMarket[];
}

/** The part of an event ticker that is the same for every series of one game: "KXNHLGOAL-26OCT08DALBUF" → "26OCT08DALBUF". */
export const gameKey = (eventTicker: string): string => eventTicker.slice(eventTicker.indexOf("-") + 1);
const seriesOf = (e: ApiEvent): string => e.series_ticker || e.event_ticker.split("-")[0];
export const eventUrl = (series: string, eventTicker: string): string => `https://kalshi.com/markets/${series.toLowerCase()}/${eventTicker.toLowerCase()}`;

/** The two team codes of a game: from the sub-title ("DAL vs BUF (Oct 8)"), else by splitting the ticker. */
export function teamsOf(e: ApiEvent, codes: string[]): string[] {
  const m = /^([A-Z0-9]{2,5})\s+(?:vs\.?|@|at)\s+([A-Z0-9]{2,5})\b/.exec(e.sub_title ?? "");
  if (m) return [m[1], m[2]];
  const tail = gameKey(e.event_ticker).replace(/^\d{2}[A-Z]{3}\d{2}(\d{4})?/, "");
  for (const a of codes) if (tail.startsWith(a) && codes.includes(tail.slice(a.length))) return [a, tail.slice(a.length)];
  return [];
}

const price = (v: string | undefined): number | null => (v == null || v === "" || !Number.isFinite(+v) ? null : +v);
const isOpen = (m: ApiWatchMarket) => !m.status || m.status === "active" || m.status === "open";

export function toMarket(m: ApiWatchMarket, useTitle = false): WatchMarket {
  const yesBid = price(m.yes_bid_dollars), yesAsk = price(m.yes_ask_dollars);
  return {
    ticker: m.ticker,
    label: (useTitle ? m.title || m.yes_sub_title : m.yes_sub_title || m.title) || m.ticker,
    yesBid, yesAsk,
    noBid: price(m.no_bid_dollars) ?? (yesAsk == null ? null : +(1 - yesAsk).toFixed(4)),
    noAsk: price(m.no_ask_dollars) ?? (yesBid == null ? null : +(1 - yesBid).toFixed(4)),
    volume: Number(m.volume_fp ?? m.volume ?? 0) || 0,
  };
}

/** Best guess at an event's time before any start-time lookup: the ticker's ET time, else Kalshi's expected result time. */
export function roughTime(e: ApiEvent): { ts: number | null; approx: boolean } {
  const t = startFromTicker(e.event_ticker);
  if (t?.ts) return { ts: t.ts, approx: false };
  const times = (e.markets ?? []).map((m) => Date.parse(m.occurrence_datetime || m.expected_expiration_time || "")).filter(Number.isFinite);
  if (times.length) return { ts: Math.min(...times), approx: true };
  return { ts: t?.date ?? null, approx: true };
}

/** "Dallas vs Buffalo: Goals" → "Dallas vs Buffalo" (a prop series' title); "Game 4: CLE vs CWS" stays. */
export const gameTitle = (t: string): string => t.replace(/^(.* (?:vs\.?|at|@) .*?):\s*[^:]+$/, "$1");

/**
 * Events → what the watcher shows, merged by `keyOf` (a game's winner, spread, totals and props are one entry).
 * Markets: the first event's in Kalshi's order, then the other events' most traded, taken in turns.
 */
function group(events: ApiEvent[], pick: (e: ApiEvent) => ApiWatchMarket[], useTitle: boolean, keyOf: (e: ApiEvent) => string): WatchEvent[] {
  const byKey = new Map<string, ApiEvent[]>();
  for (const e of events) byKey.set(keyOf(e), [...(byKey.get(keyOf(e)) ?? []), e]);
  return [...byKey.entries()].map(([key, evs]) => {
    const main = evs[0];
    const { ts, approx } = roughTime({ ...main, markets: evs.flatMap((e) => e.markets ?? []) });
    const series = seriesOf(main);
    const lists = evs.map((e, i) => {
      const ms = pick(e).filter(isOpen);
      return i ? ms.sort((a, b) => Number(b.volume_fp ?? 0) - Number(a.volume_fp ?? 0)) : ms;
    });
    const ms = [...lists[0]];
    for (let r = 0, left = true; left; r++) {
      left = false;
      for (const l of lists.slice(1)) if (r < l.length) { ms.push(l[r]); left = true; }
    }
    return {
      key, ticker: main.event_ticker, series,
      title: evs.length > 1 || useTitle ? gameTitle(main.title ?? main.event_ticker) : main.title ?? main.event_ticker,
      sub: main.sub_title ?? "",
      start: ts, approx,
      url: eventUrl(series, main.event_ticker),
      markets: ms.slice(0, MARKETS_PER_EVENT).map((m) => toMarket(m, useTitle)),
      more: Math.max(0, ms.length - MARKETS_PER_EVENT),
    };
  });
}

/** Soonest first; games that started hours ago (open until they settle) after the upcoming ones. */
export const byTime = (now: number) => (a: WatchEvent, b: WatchEvent): number => {
  const late = (e: WatchEvent) => Number(e.start != null && !e.approx && e.start < now - 4 * 3600e3);
  return late(a) - late(b) || (a.start ?? Infinity) - (b.start ?? Infinity);
};

const nameHit = (words: string[], text: string | undefined) => { const t = norm(text ?? ""); return words.every((w) => t.includes(w)); };
/** "Jack Quinn: 1+ goals" → "Jack Quinn": a prop market's player is before the colon. */
const playerPart = (m: ApiWatchMarket) => (m.title ?? m.yes_sub_title ?? "").split(":")[0];

/**
 * The events (by game, soonest first, at most `max`) for one watched item, given the open events of the
 * series it needs (`bySeries`) or, for an event item, that event.
 */
export function match(item: WatchItem, bySeries: Map<string, ApiEvent[]>, now = Date.now(), max = EVENTS_PER_ITEM): WatchEvent[] {
  const league = "league" in item ? leagueOf(item.league) : undefined;
  const all = (tickers: string[]) => tickers.flatMap((t) => bySeries.get(t) ?? []);
  const everything = (e: ApiEvent) => e.markets ?? [];
  let out: WatchEvent[];
  switch (item.kind) {
    case "league":
      out = group(all(league ? [league.game[0]] : []), everything, false, (e) => e.event_ticker);
      break;
    case "team": {
      const codes = league?.teams?.map(([c]) => c) ?? [];
      const words = norm(item.name).split(" ");
      const hit = (e: ApiEvent) => item.code ? teamsOf(e, codes).includes(item.code)
        : nameHit(words, `${e.title} ${e.sub_title}`) || (e.markets ?? []).some((m) => nameHit(words, m.yes_sub_title));
      out = group(all(league?.game ?? []).filter(hit), everything, false, (e) => gameKey(e.event_ticker));
      break;
    }
    case "player": {
      const words = norm(item.name).split(" ");
      const series = league?.props.length ? league.props : league?.game ?? [];
      const mine = (e: ApiEvent) => (e.markets ?? []).filter((m) => nameHit(words, playerPart(m)));
      out = group(all(series).filter((e) => mine(e).length), mine, true, (e) => gameKey(e.event_ticker));
      break;
    }
    case "series":
      out = group(bySeries.get(item.ticker.toUpperCase()) ?? [], everything, false, (e) => e.event_ticker);
      break;
    case "event":
      out = group(bySeries.get(`event:${item.ticker.toUpperCase()}`) ?? [], everything, false, (e) => e.event_ticker);
      break;
  }
  return out.filter((e) => e.approx || e.start == null || e.start >= now - LIVE_MS).sort(byTime(now)).slice(0, max);
}

/** The series one item needs (each fetched once per refresh, shared by every item). */
export function seriesFor(item: WatchItem): string[] {
  const l = "league" in item ? leagueOf(item.league) : undefined;
  switch (item.kind) {
    case "league": return l ? [l.game[0]] : [];
    case "team": return l?.game ?? [];
    case "player": return l ? (l.props.length ? l.props : l.game) : [];
    case "series": return [item.ticker.toUpperCase()];
    case "event": return [];
  }
}

// --- Fetching -----------------------------------------------------------

export interface WatchDeps {
  /** Open events of a series, with their markets. */
  series(ticker: string): Promise<ApiEvent[]>;
  /** One event with its markets (null when Kalshi doesn't know it). */
  event(ticker: string): Promise<ApiEvent | null>;
  /** A game's real start time (Kalshi milestones), or null. */
  start(eventTicker: string): Promise<number | null>;
}

const MAX_PAGES = 3;
/** Kalshi's public API with a short-lived memory cache, so opening the page repeatedly doesn't refetch. */
export function apiDeps(cache: Cache, ttlMs = 3 * 60e3): WatchDeps {
  return {
    async series(ticker) {
      const hit = memo.get(ticker);
      if (hit && Date.now() - hit.at < ttlMs) return hit.events;
      const events: ApiEvent[] = [];
      let cursor = "";
      // open = trading now; unopened = listed further out (e.g. next week's UFC card) with markets not open yet
      for (const status of ["open", "unopened"]) {
        cursor = "";
        for (let i = 0; i < (status === "open" ? MAX_PAGES : 1); i++) {
          const page = await publicGet<{ events?: ApiEvent[]; cursor?: string }>(
            `/events?series_ticker=${encodeURIComponent(ticker)}&status=${status}&with_nested_markets=true&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
          for (const e of page.events ?? []) if (!events.some((x) => x.event_ticker === e.event_ticker)) events.push(e);
          cursor = page.cursor ?? "";
          if (!cursor || !page.events?.length) break;
        }
      }
      memo.set(ticker, { at: Date.now(), events });
      return events;
    },
    async event(ticker) {
      try {
        const r = await publicGet<{ event?: ApiEvent; markets?: ApiWatchMarket[] }>(`/events/${encodeURIComponent(ticker)}?with_nested_markets=true`);
        return r.event ? { ...r.event, markets: r.event.markets ?? r.markets ?? [] } : null;
      } catch (e) {
        if (/-> 404$/.test((e as Error).message)) return null;
        throw e;
      }
    },
    async start(eventTicker) {
      const k = `ms:${eventTicker}`;
      const c = cache.get<{ start: number | null }>(k);
      if (c) return c.start;
      try {
        const { milestones = [] } = await publicGet<{ milestones?: { start_date?: string }[] }>(
          `/milestones?limit=5&related_event_ticker=${encodeURIComponent(eventTicker)}`);
        const m = milestones.find((x) => x.start_date);
        const start = m ? Date.parse(m.start_date!) : null;
        cache.set(k, { start });
        return start;
      } catch { return null; }
    },
  };
}
const memo = new Map<string, { at: number; events: ApiEvent[] }>();
export const forgetSeries = () => memo.clear();

/** Everything on the watchlist: each series fetched once, then each item matched, then real start times. */
export async function loadWatch(list: WatchItem[], deps: WatchDeps, now = Date.now()): Promise<WatchResults> {
  const bySeries = new Map<string, ApiEvent[]>();
  const errors = new Map<string, string>();
  const tickers = [...new Set(list.flatMap(seriesFor))];
  // Two at a time: Kalshi rate-limits anonymous requests quickly.
  await pool(tickers, 2, async (t) => {
    try { bySeries.set(t, await deps.series(t)); } catch (e) { errors.set(t, (e as Error).message); }
  });
  await pool(list.filter((i) => i.kind === "event"), 2, async (i) => {
    try {
      const ev = await deps.event(i.ticker.toUpperCase());
      bySeries.set(`event:${i.ticker.toUpperCase()}`, ev ? [ev] : []);
    } catch (e) { errors.set(`event:${i.ticker}`, (e as Error).message); }
  });
  const items: Record<string, WatchResult> = {};
  for (const i of list) {
    const failed = [...seriesFor(i), `event:${i.kind === "event" ? i.ticker : ""}`].map((t) => errors.get(t)).find(Boolean);
    items[i.id] = { events: match(i, bySeries, now), error: failed ?? null };
  }
  // Real start times for the games shown (one request per game, cached), where the ticker has no time.
  const need = new Map<string, WatchEvent[]>();
  for (const r of Object.values(items)) for (const e of r.events) if (e.approx) need.set(e.ticker, [...(need.get(e.ticker) ?? []), e]);
  await pool([...need.keys()], 2, async (t) => {
    const s = await deps.start(t);
    if (s != null) for (const e of need.get(t)!) { e.start = s; e.approx = false; }
  });
  for (const r of Object.values(items)) r.events.sort(byTime(now));
  return { at: now, items };
}

/** The Kalshi sports series list, slimmed for autocomplete. */
export async function seriesIndex(): Promise<SeriesEntry[]> {
  const { series = [] } = await publicGet<{ series?: { ticker: string; title?: string; tags?: string[] | null; category?: string }[] }>("/series?category=Sports");
  return series.filter((s) => s.ticker && s.title).map((s): SeriesEntry => [s.ticker, s.title!, s.tags?.[0] ?? s.category ?? ""])
    .sort((a, b) => a[1].localeCompare(b[1]));
}
