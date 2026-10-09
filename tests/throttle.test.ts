// Kalshi's rate limit: the shared request queue (pacing, 429 → Retry-After / backoff with jitter, retry only that
// request), and the requests a refresh saves by caching what never changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Cache } from "../src/lib/cache.ts";
import * as Kalshi from "../src/lib/kalshi.ts";
import { RateLimitError, Throttle, refreshGapMs, retryAfterMs } from "../src/lib/throttle.ts";

/** A throttle on a fake clock: sleeping advances it and is recorded. */
function fake(opts: Partial<ConstructorParameters<typeof Throttle>[0]> = {}) {
  let clock = 1_000_000;
  const waits: number[] = [];
  const q = new Throttle({ perSecond: 4, retries: 3, baseMs: 1000, maxMs: 20000, now: () => clock,
    sleep: async (ms) => { waits.push(ms); clock += ms; }, random: () => 0.5, ...opts });
  return { q, waits };
}
const res = (status: number, headers: Record<string, string> = {}) => new Response(status === 200 ? "{}" : "", { status, headers });

test("429 with Retry-After: waits that long, then retries only that request", async () => {
  const { q, waits } = fake();
  const sent: number[] = [];
  const r = await q.run(async () => (sent.push(sent.length), sent.length === 1 ? res(429, { "retry-after": "2" }) : res(200)));
  assert.equal(r.status, 200);
  assert.equal(sent.length, 2, "one retry");
  assert.deepEqual(waits, [2000]);
  assert.equal(q.limited, 1);
});

test("429 without Retry-After: exponential backoff with jitter, then RateLimitError", async () => {
  const { q, waits } = fake();
  let n = 0;
  await assert.rejects(q.run(async () => (n++, res(429))), (e) => e instanceof RateLimitError && e.retryAfterMs === 12000);
  assert.equal(n, 4, "first try + 3 retries");
  assert.deepEqual(waits, [1500, 3000, 6000], "1 s, 2 s, 4 s plus half again as jitter");
});

test("a 429 pauses the whole queue; requests are paced a few per second", async () => {
  const { q, waits } = fake();
  await q.run(async () => res(200));
  await q.run(async () => res(200));
  await q.run(async () => res(200));
  assert.deepEqual(waits, [250, 250], "4 per second");
  let first = true;
  await q.run(async () => (first ? ((first = false), res(429, { "retry-after": "5" })) : res(200)));
  assert.equal(waits.at(-1), 5000, "the retry waits out Retry-After");
  waits.length = 0;
  await q.run(async () => res(200));
  assert.deepEqual(waits, [250], "the pause already passed for the retried request");
});

test("Retry-After as seconds or an HTTP date", () => {
  assert.equal(retryAfterMs("3"), 3000);
  assert.equal(retryAfterMs(new Date(10_000).toUTCString(), 4_000), 6000);
  assert.equal(retryAfterMs(null), null);
  assert.equal(retryAfterMs("soon"), null);
});

test("background refreshes: ~1 min while a game is live or about to start, else 5 min", () => {
  const now = Date.now();
  const s = (leg: Record<string, unknown>) => ({ fetchedAt: now, items: [{ state: "alive", legs: [{ outcome: "pending", phase: null, start: null, ...leg }] }] });
  assert.equal(refreshGapMs(s({ phase: "live" }), now), 55e3);
  assert.equal(refreshGapMs(s({ start: now + 10 * 60e3 }), now), 55e3);
  assert.equal(refreshGapMs(s({ start: now + 5 * 3600e3 }), now), 5 * 60e3);
  assert.equal(refreshGapMs(s({ start: now - 30 * 3600e3 }), now), 5 * 60e3);
  assert.equal(refreshGapMs(null), 0);
});

test("refresh requests: a combo's legs and settled legs are cached, so the next refresh makes one /markets call", async () => {
  const COMBO = "KXMVECROSSCATEGORY-S1-A", A = "KXNFLGAME-26OCT11KCLV-KC", B = "KXNFLTOTAL-26OCT11KCLV-45";
  const market: Record<string, any> = {
    [COMBO]: { ticker: COMBO, event_ticker: "KXMVECROSSCATEGORY-S1", status: "active", mve_selected_legs: [{ market_ticker: A, event_ticker: "KXNFLGAME-26OCT11KCLV" }, { market_ticker: B, event_ticker: "KXNFLTOTAL-26OCT11KCLV" }] },
    [A]: { ticker: A, event_ticker: "KXNFLGAME-26OCT11KCLV", status: "finalized", result: "yes", yes_sub_title: "Kansas City" },
    [B]: { ticker: B, event_ticker: "KXNFLTOTAL-26OCT11KCLV", status: "active", yes_sub_title: "Over 45.5", yes_bid_dollars: "0.5", yes_ask_dollars: "0.52" },
  };
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const u = new URL(url);
    calls.push(u.pathname.replace("/trade-api/v2", "") + (u.searchParams.get("tickers") ? `?${u.searchParams.get("tickers")}` : ""));
    if (u.pathname.endsWith("/markets")) return Response.json({ markets: u.searchParams.get("tickers")!.split(",").map((t) => market[t]).filter(Boolean) });
    if (u.pathname.includes("/events/")) return Response.json({ event: { title: "KC vs LV", sub_title: "", series_ticker: "KXNFLGAME" } });
    return Response.json({ milestones: [] });
  }) as typeof fetch;
  try {
    const cache = new Cache();
    const pos = [{ ticker: COMBO, count: 10, market_exposure_dollars: 2, avg_price: 0.2, cost: 2, payout: 10, fees: 0, bought_ts: null }];
    const first = await Kalshi.loadSchedule(cache, pos);
    assert.deepEqual(first.items[0].legs.map((l) => l.outcome), ["won", "pending"]);
    calls.length = 0;
    const again = await Kalshi.loadSchedule(cache, pos);
    assert.deepEqual(calls.filter((c) => c.startsWith("/markets")), [`/markets?${COMBO},${B}`], "positions and open legs together; the settled leg from the cache");
    assert.deepEqual(again.items[0].legs.map((l) => [l.title, l.outcome]), first.items[0].legs.map((l) => [l.title, l.outcome]));
  } finally {
    globalThis.fetch = realFetch;
  }
});
