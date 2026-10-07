// Calendar entries: one per open position per day it plays, at its first leg that day. Plus the rules for LIVE
// and "Pending". Entries are built once per schedule and shared by every view (a render used to rebuild them
// for each day it looked at).

import type { Item, Leg, Schedule } from "../lib/types.ts";
import { addDays, dayKey, startOfDay } from "./format.ts";
import { state } from "./state.ts";

export interface CalEvent {
  ts: number;
  /** The time is Kalshi's expected result time, not a real start (shown with "~"). */
  approx: boolean;
  item: Item;
  /** This position's legs that play on this day. */
  legs: Leg[];
  /** Position in its list (1, 2, 3…), set when a list is drawn. */
  n: number;
  cls: string;
  label: string;
}

export const isOpen = (it: Item): boolean => it.state === "alive" || it.state === "pending";
export const legTime = (l: Leg): number | null => l.start ?? l.end;

// "Coco Gauff vs Elise Mertens (Oct 6)" -> "Coco Gauff vs Elise Mertens"
export const matchup = (l: Leg): string => (l.eventSub || l.eventTitle).replace(/\s*\([^)]*\)\s*$/, "");
// Legs on the same match come from different Kalshi events (e.g. KXATPMATCH-26OCT06RUNALT and
// KXATPGTOTAL-26OCT06RUNALT) whose names differ ("Gauff vs Mertens" / "Coco Gauff vs Elise Mertens").
// Group by the shared game id and keep the most descriptive name.
const gameKey = (l: Leg): string => l.eventTicker.split("-").slice(1).join("-") || l.eventTicker;
export function eventNames(legs: Leg[]): string[] {
  const best = new Map<string, string>();
  for (const l of legs) {
    const k = gameKey(l), name = matchup(l);
    if (!best.has(k) || name.length > best.get(k)!.length) best.set(k, name);
  }
  return [...best.values()];
}
const eventLabel = (legs: Leg[]): string => eventNames(legs).join(" · ");

function build(schedule: Schedule | null): CalEvent[] {
  if (!schedule) return [];
  const out: CalEvent[] = [];
  for (const item of schedule.items.filter(isOpen)) {
    const days = new Map<string, Leg[]>();
    for (const l of item.legs) {
      const ts = legTime(l);
      if (!ts) continue;
      const k = dayKey(ts);
      if (!days.has(k)) days.set(k, []);
      days.get(k)!.push(l);
    }
    for (const legs of days.values()) {
      const ts = Math.min(...legs.map((l) => legTime(l)!));
      out.push({ ts, approx: legs.some((l) => legTime(l) === ts && l.start == null), item, legs, n: 0, cls: item.state, label: eventLabel(legs) });
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

let memo: { schedule: Schedule | null; events: CalEvent[]; byDay: Map<string, CalEvent[]> } | null = null;
function index() {
  if (memo?.schedule !== state.schedule) {
    const events = build(state.schedule);
    memo = { schedule: state.schedule, events, byDay: byDay(events) };
  }
  return memo;
}

/** Every calendar entry, oldest first. */
export const buildEvents = (): CalEvent[] => index().events;
/** Entries on one day. */
export const eventsOn = (day: Date | number): CalEvent[] => index().byDay.get(dayKey(day)) ?? [];

export function byDay(events: CalEvent[]): Map<string, CalEvent[]> {
  const m = new Map<string, CalEvent[]>();
  for (const e of events) { const k = dayKey(e.ts); if (!m.has(k)) m.set(k, []); m.get(k)!.push(e); }
  return m;
}

/** A copy of the list numbered 1, 2, 3… */
export const numbered = (list: CalEvent[]): CalEvent[] => list.map((e, i) => ({ ...e, n: i + 1 }));

// A leg is LIVE when Kalshi's game status says in progress. With no usable status, a real start time (ticker or
// milestone) in the last few hours counts. A status of finished means waiting for settlement, not LIVE.
// Estimated times (Kalshi's expected-result time, marked ~) never count.
const LIVE_MS = 6 * 3600e3;
const pendingLegs = (e: CalEvent) => e.legs.filter((l) => l.outcome === "pending");
const legLive = (l: Leg, now: number) => l.outcome === "pending" && l.phase !== "done"
  && (l.phase === "live" || (l.start != null && l.start <= now && now - l.start < LIVE_MS));
/** A card is LIVE if any leg of its position is live, even one listed on another day, unless the card is for a later day. */
export const isLive = (e: CalEvent, now = Date.now()): boolean => e.ts < +addDays(startOfDay(now), 1) && e.item.legs.some((l) => legLive(l, now));
/** Listed time has passed, no result yet (still playing, delayed, or waiting for Kalshi to settle). */
export const isUnsettled = (e: CalEvent, now = Date.now()): boolean => e.ts <= now && pendingLegs(e).length > 0;

/** Today = anything still unsettled from earlier days, then today's games. One entry per position. */
export function todayEvents(today: Date): CalEvent[] {
  const todays = eventsOn(today);
  const seen = new Set(todays.map((e) => e.item.ticker));
  const carried: CalEvent[] = [];
  for (const e of buildEvents()) {
    if (e.ts >= +today || !isUnsettled(e) || seen.has(e.item.ticker)) continue;
    seen.add(e.item.ticker);
    carried.push(e);
  }
  return [...carried, ...todays];
}

