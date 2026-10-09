import { test } from "node:test";
import assert from "node:assert/strict";
import { Cache } from "../../src/lib/cache.ts";
import { tradeInfo, updateLegs } from "../../src/pro/lib/kalshi-pro.ts";

const COMBO = "KXMVECROSSCATEGORY-S1-A", LEG1 = "KXNBAGAME-26OCT07LALBOS-LAL", LEG2 = "KXNBATOTAL-26OCT07LALBOS-220";

/** A public API with the given markets; every request is recorded. */
function mockApi(markets: Record<string, any>) {
  const asked: URL[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string) => {
    const u = new URL(input);
    asked.push(u);
    if (u.pathname.endsWith("/markets")) return Response.json({ markets: (u.searchParams.get("tickers") || "").split(",").map((t) => markets[t]).filter(Boolean) });
    if (u.pathname.includes("/events/")) return Response.json({ event: { title: "Lakers at Celtics (Oct 7)", sub_title: "LAL vs BOS (Oct 7)", series_ticker: u.pathname.split("/").pop()!.split("-")[0] } });
    if (u.pathname.endsWith("/milestones")) return Response.json({ milestones: [] });
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return { asked, restore: () => void (globalThis.fetch = real) };
}

test("trade names: singles as event + pick, combos with their legs; finished lookups are cached", async () => {
  const api = mockApi({
    [COMBO]: { ticker: COMBO, status: "finalized", result: "no", mve_selected_legs: [{ market_ticker: LEG1, side: "yes" }, { market_ticker: LEG2, side: "no" }] },
    [LEG1]: { ticker: LEG1, event_ticker: "KXNBAGAME-26OCT07LALBOS", status: "finalized", result: "yes", yes_sub_title: "Los Angeles L" },
    [LEG2]: { ticker: LEG2, event_ticker: "KXNBATOTAL-26OCT07LALBOS", status: "finalized", result: "yes", yes_sub_title: "Over 220.5 points" },
  });
  try {
    const cache = new Cache();
    const { info } = await tradeInfo([COMBO, LEG1], cache);
    assert.deepEqual(info[LEG1], { event: "LAL vs BOS", pick: "Winner: Los Angeles L" });
    assert.deepEqual(info[COMBO].legs!.map((l) => [l.pick, l.side, l.result]), [["Winner: Los Angeles L", "yes", "yes"], ["Full game total: Over 220.5 points", "no", "yes"]]);
    api.asked.length = 0;
    const again = await tradeInfo([COMBO, LEG1], cache);
    assert.deepEqual(again.info, info);
    assert.equal(api.asked.length, 0, "settled names come from the cache");
  } finally {
    api.restore();
  }
});

test("alerts poll: pending legs pick up results and odds, the stored schedule isn't mutated", async () => {
  const api = mockApi({ [LEG1]: { ticker: LEG1, status: "finalized", result: "yes" }, [LEG2]: { ticker: LEG2, status: "active", yes_bid_dollars: "0.30", yes_ask_dollars: "0.40" } });
  const leg = (ticker: string, side: string) => ({ ticker, eventTicker: ticker.replace(/-[^-]+$/, ""), side, prob: 0.5, start: Date.now() - 3600e3, outcome: "pending", phase: null });
  const schedule: any = { fetchedAt: 1, requests: 0, warnings: [], items: [{ ticker: COMBO, isCombo: true, state: "alive", legs: [leg(LEG1, "yes"), leg(LEG2, "no")] }] };
  try {
    const next = await updateLegs(schedule, new Cache());
    const [a, b] = next.items[0].legs;
    assert.equal(a.outcome, "won");
    assert.equal(a.prob, null);
    assert.equal(+b.prob!.toFixed(2), 0.65, "NO side = 1 − YES midpoint");
    assert.equal(next.items[0].state, "alive");
    assert.ok(next.legsAt > 0);
    assert.equal(schedule.items[0].legs[0].outcome, "pending");
  } finally {
    api.restore();
  }
});
