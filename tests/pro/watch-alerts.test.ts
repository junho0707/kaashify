// Pro notifications for the Market Watcher: new markets for a watched item, and watched games about to start.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { WatchEvent, WatchItem, WatchResults } from "../../src/lib/watch.ts";
import { checkWatch } from "../../src/pro/lib/watch-alerts.ts";

const H = 3600e3, NOW = Date.parse("2026-10-08T16:00:00Z");
const item: WatchItem = { id: "team:NHL:COL", kind: "team", league: "NHL", code: "COL", name: "Colorado Avalanche", label: "Colorado Avalanche (NHL)" };
const event = (key: string, start: number, markets = 2, approx = false): WatchEvent => ({ key, ticker: `KXNHLGAME-${key}`, series: "KXNHLGAME",
  title: `Game ${key}`, sub: "", start, approx, url: "", more: 0,
  markets: Array.from({ length: markets }, (_, i) => ({ ticker: `M${i}`, label: "x", yesBid: 0.4, yesAsk: 0.42, noBid: 0.58, noAsk: 0.6, volume: 1 })) });
const results = (...events: WatchEvent[]): WatchResults => ({ at: NOW, items: { [item.id]: { events } } });
const on = { watchNew: true, watchStart: 3 };

test("first check only records; then new events, markets opening and starts within N hours notify once", () => {
  const a = checkWatch(results(event("A", NOW + 2 * H), event("B", NOW + 48 * H, 0)), [item], {}, on, NOW);
  assert.deepEqual(a.notes, [], "nothing on the first check");
  const b = checkWatch(results(event("A", NOW + 2 * H), event("B", NOW + 48 * H, 3), event("C", NOW + 72 * H)), [item], a.state, on, NOW);
  assert.deepEqual(b.notes.map((n) => [n.title, n.message]), [
    ["Markets open: Game B", "Colorado Avalanche (NHL) · 3 markets"],
    ["New on Kalshi: Game C", "Colorado Avalanche (NHL) · 2 markets"],
  ], "A was already within 3 h on the first check: no start alert");
  const c = checkWatch(results(event("C", NOW + 72 * H)), [item], b.state, on, NOW + 70 * H);
  assert.deepEqual(c.notes.map((n) => n.title), ["Starts in 2 h: Game C"]);
  const d = checkWatch(results(event("C", NOW + 72 * H)), [item], c.state, on, NOW + 71 * H);
  assert.deepEqual(d.notes, [], "once per game");
  assert.deepEqual(Object.keys(d.state.events), ["team:NHL:COL|C"], "state keeps only what's listed now");
});

test("settings off: no watch notifications; estimated times never count as a start", () => {
  const first = checkWatch(results(), [item], {}, on, NOW);
  assert.deepEqual(checkWatch(results(event("A", NOW + H)), [item], first.state, { watchNew: false, watchStart: 0 }, NOW).notes, []);
  assert.deepEqual(checkWatch(results(event("A", NOW + H, 0, true)), [item], first.state, { watchNew: false, watchStart: 3 }, NOW).notes, []);
});
