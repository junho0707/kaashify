// The alerts panel (bell button in the header): which notifications to show while the browser is open.

import { openDrawer } from "../../calendar/detail.ts";
import { $, $maybe } from "../../calendar/dom.ts";
import { type AlertSettings, DEFAULTS } from "../lib/alerts.ts";

const opt = (v: number, cur: number, label: string) => `<option value="${v}"${v === cur ? " selected" : ""}>${label}</option>`;

export async function showAlerts(): Promise<void> {
  const { alertSettings = {} } = await chrome.storage.local.get("alertSettings") as { alertSettings?: Partial<AlertSettings> };
  const a = { ...DEFAULTS, ...alertSettings };
  openDrawer(`
    <h2>Alerts</h2>
    <p class="sub">Desktop notifications while your browser is open.</p>
    <form id="alert-form" class="settings">
      <label class="row-set main"><input type="checkbox" name="enabled"${a.enabled ? " checked" : ""}> Turn on alerts</label>
      <label class="row-set">Game starting
        <select name="startMins">${opt(0, a.startMins, "Off")}${[5, 15, 30, 60].map((m) => opt(m, a.startMins, `${m} min before`)).join("")}</select></label>
      <label class="row-set"><input type="checkbox" name="settled"${a.settled ? " checked" : ""}> A leg wins or loses</label>
      <label class="row-set"><input type="checkbox" name="comboDone"${a.comboDone ? " checked" : ""}> A combo hits or busts</label>
      <label class="row-set">Odds move by
        <select name="oddsMove">${opt(0, a.oddsMove, "Off")}${[0.1, 0.15, 0.25].map((x) => opt(x, a.oddsMove, `${Math.round(x * 100)} points`)).join("")}</select></label>
      <h3 class="set-h">Watchlist</h3>
      <label class="row-set"><input type="checkbox" name="watchNew"${a.watchNew ? " checked" : ""}> A watched item gets new Kalshi markets</label>
      <label class="row-set">A watched game starts
        <select name="watchStart">${opt(0, a.watchStart, "Off")}${[1, 3, 6, 24].map((h) => opt(h, a.watchStart, `${h} h before`)).join("")}</select></label>
      <p class="sub" id="alert-note"></p>
    </form>`);
  const form = $<HTMLFormElement>("#alert-form");
  form.addEventListener("change", (ev) => {
    const f = new FormData(form);
    const next: AlertSettings = { enabled: f.has("enabled"), startMins: +(f.get("startMins") ?? 0), settled: f.has("settled"),
      comboDone: f.has("comboDone"), oddsMove: +(f.get("oddsMove") ?? 0), watchNew: f.has("watchNew"), watchStart: +(f.get("watchStart") ?? 0) };
    const note = $("#alert-note");
    // Must run inside the change event: browsers only show the permission prompt for a user gesture.
    const ask = (ev.target as HTMLInputElement).name === "enabled" && next.enabled
      ? chrome.permissions.request({ permissions: ["notifications"] }) : Promise.resolve(true);
    ask.then(async (granted) => {
      if (!granted) {
        next.enabled = false;
        $<HTMLInputElement>("[name=enabled]", form).checked = false;
        note.textContent = "Notifications were not allowed.";
      } else note.textContent = next.enabled ? "Alerts are on." : "";
      await chrome.storage.local.set({ alertSettings: next });
    });
  });
}

/** The bell button in the header, before Settings. */
export function initAlerts(): void {
  if ($maybe("#alerts")) return;
  const bell = Object.assign(document.createElement("button"), { id: "alerts", title: "Alerts", textContent: "🔔" });
  $("#settings").before(bell);
  bell.onclick = () => void showAlerts();
}

/** Under the Watch tab's list: where to turn on notifications for watched items. */
export const watchFooter = (): string => `<p class="sub wfoot"><button class="linkbtn" id="open-alerts">🔔 Notify me</button>
  when watched items get new markets or their games are about to start</p>`;

/** Settings section that opens the alerts panel. */
export const alertsSection = (): string => `<section class="set"><h3>Alerts</h3>
      <p><button id="open-alerts">Alert settings…</button></p></section>`;
