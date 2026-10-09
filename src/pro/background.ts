// The full service worker: the base background plus trade names and alerts.
// Listeners are added at the top level, as MV3 requires.

import { CAL_URL, addHandlers, openTab } from "../background/index.ts";
import { loadCache, onRefreshed, saveCache } from "../background/refresh.ts";
import { onWatchRefreshed } from "../background/watch.ts";
import { notifyChanges, notifyWatch, pollAlerts, syncAlertAlarm } from "./background/alerts.ts";
import { tradeInfo } from "./lib/kalshi-pro.ts";
import type { ProRequest } from "./types.ts";

const fail = (e: Error) => ({ ok: false as const, error: e.message });

addHandlers<ProRequest>({
  "trade-info": async (m) => {
    try {
      const cache = await loadCache();
      const { info } = await tradeInfo(m.tickers || [], cache);
      await saveCache(cache);
      return { ok: true, info };
    } catch (e) {
      return fail(e as Error);
    }
  },
});

onRefreshed(notifyChanges);
onWatchRefreshed(notifyWatch);

chrome.notifications?.onClicked.addListener((id) => { chrome.notifications.clear(id); openTab(); });
chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && c.alertSettings) syncAlertAlarm(); });
chrome.permissions.onAdded?.addListener(() => void syncAlertAlarm());
chrome.permissions.onRemoved?.addListener(() => void syncAlertAlarm());
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "alerts") pollAlerts({ auto: true }); });
syncAlertAlarm();

// For the end-to-end tests and debugging from the service worker console.
Object.assign((globalThis as unknown as { kaashify: object }).kaashify, { pollAlerts, syncAlertAlarm, CAL_URL });
