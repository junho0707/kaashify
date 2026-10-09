// Page state: what's loaded, which view is open, and the viewer's preferences (kept in localStorage).

import type { Schedule } from "../lib/types.ts";
import { startOfDay } from "./format.ts";

export type ViewName = "home" | "day" | "week" | "month" | "year" | "list" | "pnl" | "watch";
export type RangeKey = "24h" | "7d" | "14d" | "30d" | "90d" | "ytd" | "all";

export const prefs = { v: 2, view: "home" as ViewName, weekOpen: false, theme: null as "light" | "dark" | null, pnlRange: "all" as RangeKey };

export const state = {
  schedule: null as Schedule | null,
  /** No Kalshi API key yet: the connect form is shown instead of the calendar. */
  needsKey: false,
  /** The day the week / month / year views are centered on. */
  cursor: startOfDay(new Date()),
};

/** The calendar is shown in the overlay window on a web page (vs. its own tab). */
export const EMBED = new URLSearchParams(location.search).has("embed");

export function savePrefs(): void {
  try { localStorage.setItem("prefs", JSON.stringify(prefs)); } catch { /* storage blocked: preferences last this visit */ }
}

export function loadPrefs(): void {
  try {
    const saved = JSON.parse(localStorage.getItem("prefs") || "{}");
    if (saved.v !== 2) delete saved.view; // layout changed: open on the overview once
    Object.assign(prefs, saved, { v: 2 });
  } catch { /* defaults */ }
}
