// Alerts: desktop notifications while the browser is open. Polls public prices for open legs every minute while
// alerts are on (no position requests), and checks each new schedule for starts, results and odds moves.

import { loadCache, running, saveCache, updateBadge } from "../../background/refresh.ts";
import { kalshiQueue, refreshGapMs } from "../../lib/throttle.ts";
import type { Schedule } from "../../lib/types.ts";
import type { WatchItem, WatchResults } from "../../lib/watch.ts";
import { type AlertSettings, type AlertState, DEFAULTS, check } from "../lib/alerts.ts";
import { updateLegs } from "../lib/kalshi-pro.ts";
import { type WatchAlertState, checkWatch } from "../lib/watch-alerts.ts";

const settingsOf = async () => ((await chrome.storage.local.get("alertSettings")) as { alertSettings?: Partial<AlertSettings> }).alertSettings ?? {};
const allowed = () => chrome.permissions.contains({ permissions: ["notifications"] });

/** The "alerts" alarm runs only while alerts are on and notifications are allowed. */
export async function syncAlertAlarm(): Promise<void> {
  const on = (await settingsOf()).enabled && (await allowed());
  if (on) await chrome.alarms.create("alerts", { periodInMinutes: 1 });
  else await chrome.alarms.clear("alerts");
}

let polling = false;
/** auto: from the 1-minute alarm, which skips polls the refresh pace says aren't needed. */
export async function pollAlerts(opts: { auto?: boolean } = {}): Promise<void> {
  if (polling || running()) return;
  polling = true;
  try {
    const { schedule = null } = await chrome.storage.local.get("schedule") as { schedule?: Schedule | null };
    // Same pace as background refreshes: every minute only while a game is live or about to start.
    if (!schedule) return;
    const legsAt = (schedule as Schedule & { legsAt?: number }).legsAt ?? schedule.fetchedAt;
    if (opts.auto && Date.now() - Math.max(legsAt, schedule.fetchedAt) < refreshGapMs(schedule) - 5e3 || kalshiQueue.pausedFor() > 0) return;
    const cache = await loadCache();
    const data = await updateLegs(schedule, cache);
    // A full refresh may have finished meanwhile; don't overwrite it with older positions.
    const { schedule: latest } = await chrome.storage.local.get("schedule") as { schedule?: Schedule | null };
    if (latest?.fetchedAt !== schedule.fetchedAt) return;
    await chrome.storage.local.set({ schedule: data });
    await saveCache(cache);
    updateBadge(data);
    await notifyChanges(data);
  } catch { /* the next poll tries again */ } finally {
    polling = false;
  }
}

const show = (notes: { id: string; title: string; message: string }[]) => {
  for (const n of notes.slice(0, 5)) {
    chrome.notifications.create(n.id, { type: "basic", iconUrl: chrome.runtime.getURL("icons/128.png"), title: n.title, message: n.message, priority: 1 });
  }
};

/** After each watchlist refresh: new markets and games about to start for watched items. */
export async function notifyWatch(results: WatchResults, list: WatchItem[]): Promise<void> {
  const settings = { ...DEFAULTS, ...(await settingsOf()) };
  if (!settings.enabled || !chrome.notifications) return;
  const { watchAlertState = {} } = await chrome.storage.local.get("watchAlertState") as { watchAlertState?: WatchAlertState };
  const { notes, state } = checkWatch(results, list, watchAlertState, settings);
  await chrome.storage.local.set({ watchAlertState: state });
  show(notes);
}

export async function notifyChanges(data: Schedule): Promise<void> {
  const settings = await settingsOf();
  if (!settings.enabled || !chrome.notifications) return;
  const { alertState = {} } = await chrome.storage.local.get("alertState") as { alertState?: AlertState };
  const { notes, state } = check(data, alertState, settings);
  await chrome.storage.local.set({ alertState: state });
  show(notes);
}
