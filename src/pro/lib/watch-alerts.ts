// Notifications for the Market Watcher (Pro): a watched item gets a new Kalshi event or its markets open, or one
// of its games starts within N hours. Pure logic: compares the latest watch results with what was seen last time.

import type { WatchItem, WatchResults } from "../../lib/watch.ts";
import type { AlertSettings, Note } from "./alerts.ts";

interface Seen { markets: number; started: boolean }
/** What the last check saw, per "item id|game key". */
export interface WatchAlertState { events?: Record<string, Seen> }

const hours = (ms: number) => { const h = ms / 3600e3; return h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : `${Math.round(h)} h`; };

/** The first check only records what's there, so turning alerts on doesn't announce every existing market. */
export function checkWatch(results: WatchResults | null | undefined, list: WatchItem[], prev: WatchAlertState | null | undefined,
  settings: Pick<AlertSettings, "watchNew" | "watchStart">, now = Date.now()): { notes: Note[]; state: Required<WatchAlertState> } {
  const first = !prev?.events;
  const notes: Note[] = [], state: Required<WatchAlertState> = { events: {} };
  for (const item of list) {
    for (const e of results?.items[item.id]?.events ?? []) {
      const key = `${item.id}|${e.key}`;
      const was = prev?.events?.[key];
      const soon = settings.watchStart > 0 && e.start != null && !e.approx && e.start > now && e.start - now <= settings.watchStart * 3600e3;
      const cur: Seen = { markets: e.markets.length, started: !!was?.started || (first && soon) };
      state.events[key] = cur;
      if (first) continue;
      if (settings.watchNew && e.markets.length && (!was || !was.markets)) {
        notes.push({ id: `watch-new:${key}`, title: `${was ? "Markets open" : "New on Kalshi"}: ${e.title}`,
          message: `${item.label} · ${e.markets.length + e.more} market${e.markets.length + e.more === 1 ? "" : "s"}` });
      }
      if (soon && !cur.started) {
        cur.started = true;
        notes.push({ id: `watch-start:${key}`, title: `Starts in ${hours(e.start! - now)}: ${e.title}`, message: item.label });
      }
    }
  }
  return { notes, state };
}
