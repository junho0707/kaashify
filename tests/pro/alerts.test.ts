import { test } from "node:test";
import assert from "node:assert/strict";
import * as Alerts from "../../src/pro/lib/alerts.ts";

const MIN = 60e3, now = Date.UTC(2026, 9, 7, 18, 0);
const leg = (o = {}) => ({ ticker: "KXMLBGAME-26OCT071815LADATL-LAD", eventTicker: "KXMLBGAME-26OCT071815LADATL", eventTitle: "LAD vs ATL", eventSub: "",
  side: "yes", title: "Los Angeles D", start: now + 60 * MIN, prob: 0.5, outcome: "pending", ...o }) as any;
const sched = (legs: any[], o = {}) => ({ items: [{ ticker: "C1", isCombo: legs.length > 1, state: "alive", payout: 10, legs, ...o }] });
const ON = { enabled: true };

test("first check only records state", () => {
  const { notes, state } = Alerts.check(sched([leg({ start: now + 5 * MIN }), leg({ ticker: "B", outcome: "won" })]), {}, ON, now);
  assert.deepEqual(notes, []);
  assert.equal(state.legs["C1|KXMLBGAME-26OCT071815LADATL-LAD"].started, true);
});

test("starting soon fires once", () => {
  const { state } = Alerts.check(sched([leg()]), {}, ON, now);
  const t = now + 46 * MIN;
  const a = Alerts.check(sched([leg()]), state, ON, t);
  assert.deepEqual(a.notes.map((n) => n.title), ["Starts in 14 min: LAD vs ATL"]);
  assert.deepEqual(Alerts.check(sched([leg()]), a.state, ON, t + MIN).notes, []);
});

test("leg results and combo hit/busted", () => {
  const legs = [leg(), leg({ ticker: "B", title: "Over 8.5" })];
  const { state } = Alerts.check(sched(legs), {}, ON, now);
  const after = sched([leg({ outcome: "won" }), leg({ ticker: "B", title: "Over 8.5", outcome: "lost" })], { state: "busted" });
  assert.deepEqual(Alerts.check(after, state, ON, now).notes.map((n) => n.title).sort(),
    ["Combo busted", "Leg lost: LAD vs ATL", "Leg won: LAD vs ATL"]);
});

test("odds move past the threshold, then re-base", () => {
  const { state } = Alerts.check(sched([leg({ prob: 0.5 })]), {}, ON, now);
  assert.deepEqual(Alerts.check(sched([leg({ prob: 0.6 })]), state, ON, now).notes, []);
  const moved = Alerts.check(sched([leg({ prob: 0.3 })]), state, ON, now);
  assert.equal(moved.notes[0].message, "Los Angeles D: 50% → 30%");
  assert.deepEqual(Alerts.check(sched([leg({ prob: 0.35 })]), moved.state, ON, now).notes, []);
});

test("each alert type can be turned off", () => {
  const { state } = Alerts.check(sched([leg()]), {}, ON, now);
  const off = { enabled: true, startMins: 0, settled: false, comboDone: false, oddsMove: 0 };
  assert.deepEqual(Alerts.check(sched([leg({ outcome: "won", prob: 0.9 })], { state: "hit" }), state, off, now + 59 * MIN).notes, []);
});
