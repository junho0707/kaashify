// Settings (in the drawer), theme, "Save debug info" and "Clear all my data".

import type { LastError, Schedule } from "../lib/types.ts";
import { KALSHI_KEYS_URL } from "./connect.ts";
import { openDrawer } from "./detail.ts";
import { $, $maybe, download, esc } from "./dom.ts";
import { prefs, savePrefs } from "./state.ts";

const PRIVACY_URL = "https://github.com/junho0707/kaashify/blob/main/PRIVACY.md";
const ISSUES_URL = "https://github.com/junho0707/kaashify/issues";

const opt = (v: string, cur: string | null, label: string) => `<option value="${v}"${v === (cur ?? "") ? " selected" : ""}>${label}</option>`;

export async function showSettings(): Promise<void> {
  const { keyInfo = null } = await chrome.storage.local.get("keyInfo") as { keyInfo?: { keyId: string } | null };
  openDrawer(`
    <h2>Settings</h2>
    <section class="set"><h3>Kalshi account</h3>
      ${keyInfo ? `<p>Connected ✓ <span class="sub">key ${esc(keyInfo.keyId)}…</span></p>
        <p><button id="rekey">Use a different key</button> <button id="unkey">Disconnect</button></p>
        <p class="sub">To revoke the key everywhere, delete it on <a href="${KALSHI_KEYS_URL}" target="_blank" rel="noopener">Kalshi ↗</a>.</p>`
        : `<p>Not connected.</p><p><button id="rekey" class="primary">Set up</button></p>`}</section>
    <section class="set"><h3>Appearance</h3>
      <label class="row-set">Theme <select id="theme-pick">${opt("", prefs.theme, "Same as system")}${opt("light", prefs.theme, "Light")}${opt("dark", prefs.theme, "Dark")}</select></label></section>
    <section class="set"><h3>Help &amp; data</h3>
      <p><button class="copy-debug">Save debug info</button> <span class="sub">a file to send with a bug report (no amounts, no key)</span></p>
      <p><a href="${ISSUES_URL}" target="_blank" rel="noopener">Report a problem ↗</a> · <a href="${PRIVACY_URL}" target="_blank" rel="noopener">Privacy policy ↗</a></p>
      <p><button id="clear" class="danger">Clear all my data</button></p></section>
    <p class="sub">Kaashify v${esc(chrome.runtime.getManifest().version)} · not affiliated with Kalshi · not trading advice</p>`);
}

/** Light / dark: follows the system until the user picks one. */
export function applyTheme(): void {
  const dark = prefs.theme ? prefs.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const b = $("#theme");
  b.textContent = dark ? "☀" : "☾";
  b.title = dark ? "Switch to light mode" : "Switch to dark mode";
}

export function setTheme(theme: "light" | "dark" | null): void {
  prefs.theme = theme;
  savePrefs();
  applyTheme();
}

/** Saves recent refreshes and per-leg calendar data (tickers, times, status; no amounts or keys) for bug reports. */
export async function copyDebug(): Promise<void> {
  const { refreshLog = [], lastError = null, schedule = null } = await chrome.storage.local.get(["refreshLog", "lastError", "schedule"]) as
    { refreshLog?: unknown[]; lastError?: LastError | null; schedule?: Schedule | null };
  const iso = (t: number | null | undefined) => (t ? new Date(t).toISOString() : null);
  const calendar = schedule && { fetchedAt: iso(schedule.fetchedAt), via: schedule.via, items: schedule.items.map((it) => ({
    ticker: it.ticker, state: it.state, legs: it.legs.map((l) => ({ ticker: l.ticker, side: l.side, outcome: l.outcome, phase: l.phase ?? null,
      start: iso(l.start), end: iso(l.end), prob: l.prob })) })) };
  const text = JSON.stringify({ version: chrome.runtime.getManifest().version, userAgent: navigator.userAgent, lastError, refreshLog, calendar }, null, 2);
  // Clipboard access is often blocked inside the overlay frame, so also save it as a file.
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; } catch {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    document.body.appendChild(ta); ta.select();
    try { copied = document.execCommand("copy"); } catch { /* saved as a file below */ }
    ta.remove();
  }
  download("kaashify-debug.json", text, "application/json");
  document.querySelectorAll(".copy-debug").forEach((b) => (b.textContent = copied ? "Copied + saved kaashify-debug.json" : "Saved kaashify-debug.json"));
}

/** Removes everything the extension stored (key, positions, caches, settings). */
export async function clearAll(): Promise<void> {
  if (!confirm("Remove all Kaashify data from this browser, including your Kalshi API key?")) return;
  await chrome.runtime.sendMessage({ type: "clear" });
  try { localStorage.clear(); } catch { /* nothing stored */ }
  location.reload();
}

/** True when the page is in Settings, so it can be redrawn after a change. */
export const settingsOpen = (): boolean => !!$maybe("#theme-pick");
