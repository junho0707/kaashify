// Refreshing: positions from Kalshi's API (or the last copy on a network error) → schedule → storage and badge.

import * as Auth from "../lib/auth.ts";
import { Cache } from "../lib/cache.ts";
import * as Kalshi from "../lib/kalshi.ts";
import type { History, LastError, Position, RefreshResult, Schedule } from "../lib/types.ts";

const LOG_MAX = 20;

Kalshi.setSigner(async (method, path) => {
  const rec = await Auth.load();
  return rec && Auth.headersFor(rec, method, path);
});

/** The shared cache (event names, start times, settled results), loaded from storage once per run. */
export async function loadCache(): Promise<Cache> {
  const { eventCache } = await chrome.storage.local.get("eventCache");
  return new Cache(eventCache);
}
/** Saves the cache only if it changed, after dropping entries that haven't been used in a while. */
export async function saveCache(cache: Cache): Promise<void> {
  cache.prune();
  if (cache.dirty) await chrome.storage.local.set({ eventCache: cache.toJSON() });
}

// Concurrent refresh requests (open + alarm + calendar timer) share one run.
let inFlight: Promise<RefreshResult> | null = null;
export const running = () => inFlight;
export function refresh(source?: { interactive?: boolean }): Promise<RefreshResult> {
  return (inFlight ??= doRefresh(source).finally(() => (inFlight = null)));
}

/** Keeps the last few refreshes (no personal data) so "Save debug info" shows what happened. */
async function logRefresh(entry: Record<string, unknown>): Promise<void> {
  const { refreshLog = [] } = await chrome.storage.local.get("refreshLog") as { refreshLog?: unknown[] };
  await chrome.storage.local.set({ refreshLog: [entry, ...refreshLog].slice(0, LOG_MAX) });
}

async function doRefresh(source?: { interactive?: boolean }): Promise<RefreshResult> {
  const t0 = Date.now();
  const log: Record<string, unknown> = { at: t0, trigger: source?.interactive ? "open" : "background" };
  const { lastPositions = null } = await chrome.storage.local.get("lastPositions") as { lastPositions?: { positions: Position[]; at: number } | null };
  const cache = await loadCache();
  try {
    let positions: Position[], staleAt: number | null = null, reason: string | null = null, via: Schedule["via"] = "api";
    try {
      positions = await Kalshi.myPositions();
      await chrome.storage.local.set({ lastPositions: { positions, at: Date.now() } });
    } catch (e) {
      // A missing or rejected key must be shown, not hidden behind old data; a network hiccup falls back to the last copy.
      if (e instanceof Kalshi.AuthError || !lastPositions) throw e;
      positions = lastPositions.positions; staleAt = lastPositions.at; reason = (e as Error).message; via = "snapshot";
      log.reasons = reason;
    }
    log.via = via;
    const data: Schedule = { ...(await Kalshi.loadSchedule(cache, positions)), staleAt, staleReason: reason, via };
    Object.assign(log, { ok: true, positions: data.items.length, warnings: data.warnings.slice(0, 10), requests: data.requests, cacheSize: cache.size });
    await chrome.storage.local.set({ schedule: data, lastError: null });
    await saveCache(cache);
    updateBadge(data);
    return { ok: true, data };
  } catch (e) {
    const message = (e as Error).message;
    log.ok = false;
    log.error = message;
    const needsKey = e instanceof Kalshi.NoKeyError;
    const lastError: LastError = { message, auth: e instanceof Kalshi.AuthError, needsKey, debug: !needsKey, at: Date.now() };
    await chrome.storage.local.set({ lastError });
    chrome.action.setBadgeText({ text: needsKey ? "" : "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#b3261e" });
    return { ok: false, error: lastError };
  } finally {
    log.ms = Date.now() - t0;
    await logRefresh(log);
  }
}

/** Toolbar badge: how many pending legs play today. */
export function updateBadge(data: Schedule): void {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const from = start.getTime(), to = from + 864e5;
  const n = data.items
    .filter((it) => it.state === "alive" || it.state === "pending")
    .flatMap((it) => it.legs)
    .filter((l) => { const ts = l.start ?? l.end; return l.outcome === "pending" && ts != null && ts >= from && ts < to; }).length;
  chrome.action.setBadgeText({ text: n ? String(n) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#00dd94" });
  chrome.action.setBadgeTextColor?.({ color: "#062b1d" });
}

/** Connect: import the key (non-extractable), check it with one signed request, then load positions. */
export async function setKey(keyId: string, pem: string): Promise<RefreshResult> {
  await Auth.save(keyId, pem);
  try {
    await Kalshi.checkKey();
  } catch (e) {
    await Auth.clear();
    throw e;
  }
  await chrome.storage.local.set({ keyInfo: { keyId: String(keyId).trim().slice(0, 8), at: Date.now() } });
  return refresh({ interactive: true });
}

export async function removeKey(): Promise<void> {
  await Auth.clear();
  await chrome.storage.local.remove(["keyInfo", "schedule", "lastPositions", "pnlLive"]);
  chrome.action.setBadgeText({ text: "" });
  await refresh({});
}

/** P&L history: only fills newer than the stored copy are fetched. */
export async function pnlLive(): Promise<History> {
  const { pnlLive: prev = null } = await chrome.storage.local.get("pnlLive") as { pnlLive?: History | null };
  const cache = await loadCache();
  const live = await Kalshi.history(cache, prev);
  await chrome.storage.local.set({ pnlLive: live });
  await saveCache(cache);
  return live;
}
