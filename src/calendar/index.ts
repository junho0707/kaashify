// The calendar page (its own tab, or the overlay window on a web page): renders the schedule the background
// keeps in storage, and redraws whenever it changes.

import type { LastError, RefreshResult, Request, Schedule } from "../lib/types.ts";
import { initConnect, showStatus } from "./connect.ts";
import { closeDetail, drawerOpen, toggleDetail } from "./detail.ts";
import { $, $maybe, closest } from "./dom.ts";
import { startOfDay } from "./format.ts";
import { forgetFetch, initPnl, renderPnl } from "./pnl-view.ts";
import { applyTheme, clearAll, copyDebug, setTheme, showSettings } from "./settings.ts";
import { EMBED, type ViewName, loadPrefs, prefs, savePrefs, state } from "./state.ts";
import { evIndex, resetEvIndex, summaryHtml, views } from "./views.ts";

if (EMBED) document.body.classList.add("embed");
const closeOverlay = () => parent.postMessage("kcc-close", "*");

function render(): void {
  resetEvIndex();
  const v = views[prefs.view] ?? views.home;
  document.querySelectorAll<HTMLElement>("[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === prefs.view));
  $("#range").textContent = v.title();
  $(".nav").hidden = prefs.view === "home" || prefs.view === "list" || prefs.view === "pnl";
  $("#main").innerHTML = v.render();
  $("#summary").innerHTML = summaryHtml();
  if (prefs.view === "pnl") renderPnl();
}

async function load(): Promise<void> {
  const s = await chrome.storage.local.get(["schedule", "lastError"]) as { schedule?: Schedule | null; lastError?: LastError | null };
  state.schedule = s.schedule || null;
  state.needsKey = !!s.lastError?.needsKey;
  // Don't wipe a half-filled key form when a background refresh lands.
  if (!$maybe("#key-form") || !s.lastError?.needsKey) showStatus(s.lastError);
  render();
}

async function refresh(): Promise<void> {
  $("#sync").hidden = false;
  try {
    await Promise.race([
      chrome.runtime.sendMessage({ type: "refresh", interactive: true } satisfies Request) as Promise<RefreshResult>,
      new Promise((r) => setTimeout(r, 45000)),
    ]);
  } catch { /* shown through lastError */ } finally {
    $("#sync").hidden = true;
    await load();
  }
}

// After the extension is reloaded or updated, a window that was already open can't reach it any more:
// say so once instead of throwing on every timer.
let staleShown = false;
function extensionGone(): boolean {
  if (chrome.runtime?.id) return false;
  if (!staleShown) {
    staleShown = true;
    const el = $("#status");
    el.hidden = false;
    el.className = "status err";
    el.textContent = "Kaashify was updated. Close this window and click the Kaashify icon again (or reload this page).";
  }
  return true;
}

function go(view: ViewName, cursor?: Date): void {
  if (cursor) state.cursor = cursor;
  prefs.view = view;
  render();
}

// ---------- wiring ----------

loadPrefs();
applyTheme();
initPnl();
initConnect(() => { forgetFetch(); load(); });

document.addEventListener("click", async (ev) => {
  const t = closest(ev.target, "[data-view],[data-go],[data-month],[data-ev]");
  if (t?.dataset.view) {
    if (t.closest(".strip")) state.cursor = startOfDay(new Date());
    go(t.dataset.view as ViewName);
    savePrefs();
  } else if (t?.dataset.go) go("day", new Date(+t.dataset.go));
  else if (t?.dataset.month) go("month", new Date(+t.dataset.month));
  else if (t?.dataset.ev) toggleDetail(evIndex[+t.dataset.ev]);

  const id = (ev.target as Element).id;
  if (closest(ev.target, ".copy-debug")) copyDebug();
  if (id === "rekey") { closeDetail(); showStatus({ needsKey: true }); scrollTo(0, 0); }
  if (id === "clear") clearAll();
  if (id === "unkey" && confirm("Disconnect your Kalshi API key from Kaashify? (Delete it on Kalshi too if you won't use it again.)")) {
    await chrome.runtime.sendMessage({ type: "remove-key" } satisfies Request);
    closeDetail();
    await load();
  }
});
document.addEventListener("change", (e) => {
  const el = e.target as HTMLSelectElement;
  if (el.id === "theme-pick") setTheme((el.value || null) as "light" | "dark" | null);
});
document.addEventListener("toggle", (e) => {
  const d = e.target as HTMLDetailsElement;
  if (d.id === "weekstrip") { prefs.weekOpen = d.open; savePrefs(); }
}, true);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (drawerOpen()) closeDetail();
    else if (EMBED) closeOverlay();
  }
  if ((e.target as Element).matches("input,select,textarea")) return;
  if (e.key === "ArrowLeft") $("#prev").click();
  if (e.key === "ArrowRight") $("#next").click();
  if (e.key === "t") $("#today").click();
});

$("#prev").onclick = () => go(prefs.view, views[prefs.view].step(-1));
$("#next").onclick = () => go(prefs.view, views[prefs.view].step(1));
$("#today").onclick = () => go(prefs.view, startOfDay(new Date()));
$("#theme").onclick = () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
$("#x").onclick = closeOverlay;
$("#close").onclick = closeDetail;
$("#settings").onclick = showSettings;
$("#foot-settings").onclick = showSettings;
$("#ver").textContent = `v${chrome.runtime.getManifest().version}`;

// Panels open below the header, so its buttons (incl. the overlay's ×) stay clickable; the header can wrap.
const syncBarHeight = () => document.documentElement.style.setProperty("--bar-h", `${$(".bar").offsetHeight}px`);
if (typeof ResizeObserver === "function") new ResizeObserver(syncBarHeight).observe($(".bar"));
syncBarHeight();

// The toolbar button on browser pages reuses this tab instead of opening another (overlay frames stay quiet).
chrome.runtime.onMessage.addListener((msg: Request, _sender, sendResponse) => {
  if (msg?.type !== "focus-calendar" || EMBED) return;
  chrome.tabs.getCurrent().then(async (tab) => {
    await chrome.tabs.update(tab!.id!, { active: true });
    await chrome.windows.update(tab!.windowId, { focused: true }).catch(() => {});
    sendResponse(true);
  }).catch(() => sendResponse(false));
  return true;
});
chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && (c.schedule || c.lastError)) load(); });

load().then(refresh); // always pull fresh data when opened
// While the calendar is on screen, keep it current (paused when hidden).
setInterval(() => {
  if (document.visibilityState === "visible" && !extensionGone()) chrome.runtime.sendMessage({ type: "refresh" } satisfies Request).catch(() => {});
}, 60e3);
