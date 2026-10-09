// Background service worker: keeps the schedule fresh (every 30 minutes and whenever the calendar is open),
// answers the calendar page's messages, and opens the calendar from the toolbar button.

import * as Auth from "../lib/auth.ts";
import { AuthError } from "../lib/kalshi.ts";
import type { PnlLiveResult, Request } from "../lib/types.ts";
import { toggleOverlay, type OverlayRect } from "./overlay.ts";
import { pnlLive, refresh, removeKey, running, setKey } from "./refresh.ts";
import { refreshWatch, watchArea, watchHandlers } from "./watch.ts";

export const CAL_URL = chrome.runtime.getURL("calendar.html");
const REFRESH_MIN = 30;

/** Focuses an open calendar tab, or opens one. Asking the calendar page itself avoids the "tabs" permission. */
export async function openTab(): Promise<void> {
  const found = await chrome.runtime.sendMessage({ type: "focus-calendar" } satisfies Request).catch(() => false);
  if (!found) await chrome.tabs.create({ url: CAL_URL });
}

chrome.action.onClicked.addListener(async (tab) => {
  try {
    const { overlaySize = null } = await chrome.storage.local.get("overlaySize") as { overlaySize?: OverlayRect | null };
    await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: toggleOverlay, args: [CAL_URL + "?embed=1", overlaySize] });
  } catch {
    await openTab(); // browser-internal pages (new tab, settings, stores) can't host the overlay
  }
});

/** Handlers for a union of message types, each getting its own message shape. */
export type Handlers<R extends { type: string }> = { [K in R["type"]]: (msg: Extract<R, { type: K }>) => Promise<unknown> };
/** Each message type → its async handler; the result goes back to the page. */
const handlers: Record<string, (msg: never) => Promise<unknown>> = {
  refresh: (msg) => refresh({ interactive: !!msg.interactive, auto: !msg.interactive }),
  "set-key": (msg) => setKey(msg.keyId, msg.pem).catch((e: Error) => ({ ok: false, error: { message: e.message } })),
  "remove-key": async () => { await removeKey(); return { ok: true }; },
  clear: async () => {
    await Promise.all([chrome.storage.local.clear(), chrome.storage.session.clear(), Auth.clear(), watchArea().remove("watchlist")]);
    chrome.alarms.create("refresh", { periodInMinutes: REFRESH_MIN });
    chrome.action.setBadgeText({ text: "" });
    return { ok: true };
  },
  "pnl-live": () => pnlLive().then(
    (live): PnlLiveResult => ({ ok: true, live }),
    (e: Error): PnlLiveResult => ({ ok: false, auth: e instanceof AuthError, error: e.message })),
  ...watchHandlers,
} satisfies Partial<Handlers<Request>> & typeof watchHandlers;

/** Adds message handlers (the paid build's payment and Pro messages). */
export function addHandlers<R extends { type: string }>(more: Handlers<R>): void {
  Object.assign(handlers, more);
}

chrome.runtime.onMessage.addListener((msg: { type: string }, _sender, sendResponse) => {
  const handle = Object.hasOwn(handlers, msg?.type) ? handlers[msg.type] as (m: unknown) => Promise<unknown> : undefined;
  if (!handle) return;
  handle(msg).then(sendResponse);
  return true; // async response
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.alarms.create("refresh", { periodInMinutes: REFRESH_MIN });
  refresh();
  // First install: open the calendar, which walks the user through connecting their Kalshi key.
  if (reason === "install") chrome.tabs.create({ url: CAL_URL });
});
chrome.runtime.onStartup?.addListener(() => void refresh());
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "refresh" || a.name === "refresh-retry") refresh(); });

// For the end-to-end tests and debugging from the service worker console. Pages can't reach this.
Object.assign(globalThis, { kaashify: { refresh, refreshWatch, setKey, removeKey, openTab, running, Auth, CAL_URL, toggleOverlay } });
