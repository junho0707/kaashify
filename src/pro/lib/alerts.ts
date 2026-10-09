// Alerts while the browser is open. Pure logic: compares the schedule with what was seen last time and returns
// the notifications to show. The background polls and shows them.

import type { Leg, Schedule } from "../../lib/types.ts";

export interface AlertSettings {
  enabled: boolean; startMins: number; settled: boolean; comboDone: boolean; oddsMove: number;
  /** Watchlist: a watched item gets a new Kalshi event, or its markets open. */
  watchNew: boolean;
  /** Watchlist: hours before a watched game starts (0 = off). */
  watchStart: number;
}
export const DEFAULTS: AlertSettings = { enabled: false, startMins: 15, settled: true, comboDone: true, oddsMove: 0.15, watchNew: true, watchStart: 1 };

interface LegState { outcome: Leg["outcome"]; base: number | null; started: boolean }
/** What the last check saw: per leg ("combo|leg") and per position. */
export interface AlertState { legs?: Record<string, LegState>; items?: Record<string, string> }
export interface Note { id: string; title: string; message: string }

type AlertLeg = Pick<Leg, "ticker" | "eventTicker" | "eventTitle" | "eventSub" | "side" | "title" | "start" | "prob" | "outcome">;
type AlertSchedule = { items: { ticker: string; isCombo: boolean; state: string; payout: number | null; legs: AlertLeg[] }[] };

const pct = (p: number) => `${Math.round(p * 100)}%`;
const name = (l: AlertLeg) => (l.eventSub || l.eventTitle || l.eventTicker).replace(/\s*\([^)]*\)\s*$/, "");
const no = (l: AlertLeg) => (l.side === "no" ? "NO · " : "");

/**
 * prev = state from the last check ({} the first time). The first check only records state, so turning alerts
 * on doesn't replay old results.
 */
export function check(schedule: Schedule | AlertSchedule | null | undefined, prev: AlertState | null | undefined,
  settings: Partial<AlertSettings> | null | undefined, now = Date.now()): { notes: Note[]; state: Required<AlertState> } {
  const s = { ...DEFAULTS, ...settings };
  const first = !prev?.legs;
  const notes: Note[] = [], state: Required<AlertState> = { legs: {}, items: {} };
  for (const it of schedule?.items ?? []) {
    const was = prev?.items?.[it.ticker];
    state.items[it.ticker] = it.state;
    if (s.comboDone && it.isCombo && was === "alive" && (it.state === "hit" || it.state === "busted")) {
      notes.push({ id: `combo:${it.ticker}:${it.state}`,
        title: it.state === "hit" ? `Combo hit: ${it.payout != null ? `$${it.payout.toFixed(2)}` : ""}`.trim() : "Combo busted",
        message: [...new Set(it.legs.map(name))].join(" · ") });
    }
    for (const l of it.legs) {
      const key = `${it.ticker}|${l.ticker}`;
      const p: Partial<LegState> = prev?.legs?.[key] ?? {};
      const cur: LegState = { outcome: l.outcome, base: p.base ?? l.prob ?? null, started: !!p.started };
      state.legs[key] = cur;
      const soon = l.start != null && l.start - now <= s.startMins * 60e3;
      if (first) { cur.started = soon; continue; }
      if (l.outcome === "pending" && s.startMins && l.start != null && !cur.started && soon) {
        cur.started = true;
        if (l.start > now - 10 * 60e3) {
          const mins = Math.max(0, Math.round((l.start - now) / 60e3));
          notes.push({ id: `start:${key}`, title: mins ? `Starts in ${mins} min: ${name(l)}` : `Starting now: ${name(l)}`,
            message: `${no(l)}${l.title}${l.prob != null ? ` (${pct(l.prob)} now)` : ""}` });
        }
      }
      if (s.settled && p.outcome === "pending" && (l.outcome === "won" || l.outcome === "lost")) {
        notes.push({ id: `leg:${key}:${l.outcome}`, title: `${l.outcome === "won" ? "Leg won" : "Leg lost"}: ${name(l)}`, message: `${no(l)}${l.title}` });
      }
      if (s.oddsMove && l.outcome === "pending" && l.prob != null && cur.base != null && Math.abs(l.prob - cur.base) >= s.oddsMove) {
        notes.push({ id: `odds:${key}:${now}`, title: `Odds ${l.prob > cur.base ? "up" : "down"}: ${name(l)}`,
          message: `${no(l)}${l.title}: ${pct(cur.base)} → ${pct(l.prob)}` });
        cur.base = l.prob;
      }
    }
  }
  return { notes, state };
}
