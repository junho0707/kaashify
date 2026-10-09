// Market Watcher, background side: refreshes the watched items' events and markets from Kalshi's public API
// every 15 minutes while the watchlist isn't empty (and when the Watch tab asks), and keeps the series list
// for autocomplete. No API key is used. Results go to storage.local.watchResults; the page draws them.

import { Cache } from "../lib/cache.ts";
import { type SeriesEntry, type WatchItem, type WatchResults, type WatchSeriesResult, apiDeps, loadWatch, seriesIndex } from "../lib/watch.ts";
import { loadCache, saveCache } from "./refresh.ts";

export const WATCH_MIN = 15;
/** A refresh the page asks for (not forced) reuses results younger than this. */
const FRESH_MS = 2 * 60e3;
const SERIES_MAX_AGE = 7 * 864e5;

/** The watchlist lives in storage.sync (it follows the user's browser profile); local where sync is missing. */
export const watchArea = (): chrome.storage.StorageArea => chrome.storage.sync ?? chrome.storage.local;
export async function getWatchlist(): Promise<WatchItem[]> {
  const { watchlist = [] } = await watchArea().get("watchlist") as { watchlist?: WatchItem[] };
  return Array.isArray(watchlist) ? watchlist : [];
}

/** Called after each watch refresh (the paid build's notifications hook in here). */
const hooks: ((r: WatchResults, list: WatchItem[]) => Promise<void> | void)[] = [];
export const onWatchRefreshed = (fn: (r: WatchResults, list: WatchItem[]) => Promise<void> | void) => void hooks.push(fn);

let inFlight: Promise<WatchResults> | null = null;
/** One run at a time; a request during a run waits for it, then runs (the list may have changed meanwhile). */
export function refreshWatch(opts: { force?: boolean } = {}): Promise<WatchResults> {
  if (inFlight) return inFlight.then(() => refreshWatch(opts), () => refreshWatch(opts));
  return (inFlight = doRefresh(!!opts.force).finally(() => (inFlight = null)));
}

async function doRefresh(force: boolean): Promise<WatchResults> {
  const list = await getWatchlist();
  const { watchResults: prev = null } = await chrome.storage.local.get("watchResults") as { watchResults?: WatchResults | null };
  const covered = !!prev && list.every((i) => prev.items[i.id]);
  if (!force && covered && Date.now() - prev!.at < FRESH_MS) return prev!;
  let cache: Cache;
  try { cache = await loadCache(); } catch { cache = new Cache(); }
  const results: WatchResults = list.length ? await loadWatch(list, apiDeps(cache)) : { at: Date.now(), items: {} };
  await chrome.storage.local.set({ watchResults: results });
  await saveCache(cache).catch(() => {});
  for (const fn of hooks) await fn(results, list);
  return results;
}

/** The "watch" alarm runs only while something is watched. */
export async function syncWatchAlarm(): Promise<void> {
  if ((await getWatchlist()).length) await chrome.alarms.create("watch", { periodInMinutes: WATCH_MIN });
  else await chrome.alarms.clear("watch");
}

/** Kalshi's sports series for autocomplete: one large request, kept for a week. */
export async function seriesList(): Promise<SeriesEntry[]> {
  const { seriesIndex: saved = null } = await chrome.storage.local.get("seriesIndex") as { seriesIndex?: { at: number; list: SeriesEntry[] } | null };
  if (saved && Date.now() - saved.at < SERIES_MAX_AGE) return saved.list;
  try {
    const list = await seriesIndex();
    await chrome.storage.local.set({ seriesIndex: { at: Date.now(), list } });
    return list;
  } catch (e) {
    if (saved) return saved.list;
    throw e;
  }
}

export const watchHandlers = {
  "watch-refresh": (m: { force?: boolean }) => refreshWatch({ force: !!m.force }).then((r) => ({ ok: true, results: r }), (e: Error) => ({ ok: false, error: e.message })),
  "watch-series": () => seriesList().then((list): WatchSeriesResult => ({ ok: true, list }), (e: Error): WatchSeriesResult => ({ ok: false, error: e.message })),
};

chrome.storage.onChanged.addListener((c, area) => {
  if (!c.watchlist || (area !== "sync" && area !== "local")) return;
  void syncWatchAlarm();
  void refreshWatch();
});
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "watch") void refreshWatch({ force: true }); });
chrome.runtime.onInstalled.addListener(() => void syncWatchAlarm());
chrome.runtime.onStartup?.addListener(() => void syncWatchAlarm());
