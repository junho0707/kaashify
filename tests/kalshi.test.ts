// Unit tests for the data layer. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import * as Kalshi from "../src/lib/kalshi.ts";

test("ticker start time is parsed as US Eastern", () => {
  // 18:00 EDT on Oct 7 2026 = 22:00 UTC
  assert.equal(Kalshi.startFromTicker("KXMLBTOTAL-26OCT071800LADATL")!.ts, Date.UTC(2026, 9, 7, 22, 0));
  // 19:30 EST on Jan 15 2026 = 00:30 UTC next day
  assert.equal(Kalshi.startFromTicker("KXNBAGAME-26JAN151930LALBOS")!.ts, Date.UTC(2026, 0, 16, 0, 30));
});

test("date-only tickers have no start time", () => {
  assert.equal(Kalshi.startFromTicker("KXNFLGAME-26OCT11KCLV")!.ts, null);
  assert.equal(Kalshi.startFromTicker("KXHIGHNY"), null);
});

test("ticker times around the DST changes", () => {
  const ts = (t: string) => Kalshi.startFromTicker(t)!.ts!;
  // Fall back: Sun Nov 1 2026, 2:00 EDT -> 1:00 EST
  assert.equal(ts("KXNFLGAME-26OCT311800AB"), Date.UTC(2026, 9, 31, 22, 0)); // Sat, EDT (UTC-4)
  assert.equal(ts("KXNFLGAME-26NOV011300AB"), Date.UTC(2026, 10, 1, 18, 0)); // Sun afternoon, EST (UTC-5)
  assert.equal(ts("KXNFLGAME-26NOV010030AB"), Date.UTC(2026, 10, 1, 4, 30)); // 00:30 still EDT
  // 01:30 happens twice; either reading is a real instant within that hour.
  assert.ok([Date.UTC(2026, 10, 1, 5, 30), Date.UTC(2026, 10, 1, 6, 30)].includes(ts("KXNFLGAME-26NOV010130AB")));
  // Spring forward: Sun Mar 8 2026, 2:00 EST -> 3:00 EDT
  assert.equal(ts("KXNBAGAME-26MAR071900AB"), Date.UTC(2026, 2, 8, 0, 0));   // Sat evening, EST
  assert.equal(ts("KXNBAGAME-26MAR081300AB"), Date.UTC(2026, 2, 8, 17, 0));  // Sun afternoon, EDT
  // 02:30 doesn't exist; it must land within an hour of 02:00 EST / 03:00 EDT (07:00 UTC).
  assert.ok(Math.abs(ts("KXNBAGAME-26MAR080230AB") - Date.UTC(2026, 2, 8, 7, 0)) <= 3600e3);
  // 2027 changes: Mar 14 and Nov 7
  assert.equal(ts("KXNBAGAME-27MAR141300AB"), Date.UTC(2027, 2, 14, 17, 0));
  assert.equal(ts("KXNBAGAME-27NOV071300AB"), Date.UTC(2027, 10, 7, 18, 0));
});

test("ticker parsing doesn't depend on the computer's time zone", () => {
  const before = process.env.TZ;
  try {
    for (const tz of ["UTC", "Asia/Seoul", "America/Los_Angeles", "Europe/London", "Australia/Lord_Howe"]) {
      process.env.TZ = tz;
      assert.equal(Kalshi.startFromTicker("KXNFLGAME-26NOV011300AB")!.ts, Date.UTC(2026, 10, 1, 18, 0), tz);
      assert.equal(Kalshi.startFromTicker("KXMLBTOTAL-26OCT071800LADATL")!.ts, Date.UTC(2026, 9, 7, 22, 0), tz);
    }
  } finally {
    if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
  }
});

test("milestone statuses from different feeds", () => {
  const cases: Record<string, string | null> = { live: "live", P: "live", inprogress: "live", "Match in Progress - Match Stable (Bet Delay:7 seconds)": "live",
    CO: "done", finished: "done", closed: "done", "Match Complete - India have won by 8 wickets": "done", W: "done",
    not_started: null, SCH: null, unplayed: null, completed: "done", "Toss Pending   (Bet Delay:0 seconds)": null, delayed: null };
  for (const [status, phase] of Object.entries(cases)) assert.equal(Kalshi.phaseOf(status), phase, status);
  assert.equal(Kalshi.phaseOf(undefined), null);
});

test("API positions: signed count (negative = NO), average price from exposure, $1 payout per contract", () => {
  const p = Kalshi.apiPosition({ ticker: "KXNFLGAME-X-KC", position_fp: "-10.00", market_exposure_dollars: "4.000000", fees_paid_dollars: "0.140000", last_updated_ts: "2026-10-07T10:00:00Z" });
  assert.deepEqual(p, { ticker: "KXNFLGAME-X-KC", count: -10, market_exposure_dollars: 4, avg_price: 0.4, cost: 4.14, payout: 10, fees: 0.14, bought_ts: "2026-10-07T10:00:00Z" });
  assert.equal(Kalshi.apiPosition({ ticker: "KX-A-B", position_fp: "0.00" }), null);
  assert.equal(Kalshi.apiPosition({ ticker: "KX-A-B", position: 3, market_exposure: 150 })!.avg_price, 0.5); // legacy cents
});

test("API fills: outcome side and that side's price (a YES sale counts as buying NO)", () => {
  const base = { ticker: "KXA-B-C", count_fp: "5.00", yes_price_dollars: "0.6500", no_price_dollars: "0.3500", fee_cost: "0.0700", created_time: "2026-10-01T00:00:00Z" };
  assert.deepEqual(Kalshi.apiFill({ ...base, outcome_side: "yes" }), { market_ticker: "KXA-B-C", is_yes: true, count_fp: "5.00", price_dollars: 0.65, fee_dollars: 0.07, create_date: "2026-10-01T00:00:00Z", status: "confirmed" });
  assert.equal(Kalshi.apiFill({ ...base, outcome_side: "no" }).price_dollars, 0.35);
  assert.equal(Kalshi.apiFill({ ...base, side: "yes", action: "sell" }).is_yes, false); // legacy fields
  assert.equal(Kalshi.apiFill({ ...base, book_side: "bid" }).is_yes, true);
});

test("picks say which part of the game they cover", () => {
  const L = (series: string, pick: string) => Kalshi.pickLabel(series, pick);
  assert.equal(L("KXMLBF5TOTAL", "Over 6.5 runs"), "First 5 innings total: Over 6.5 runs");
  assert.equal(L("KXMLBTOTAL", "Over 13.5 runs scored"), "Full game total: Over 13.5 runs scored");
  assert.equal(L("KXNFL1HTOTAL", "Over 7.5 points"), "1st half total: Over 7.5 points");
  assert.equal(L("KXNFLSPREAD", "KC wins by over 3.5"), "Full game spread: KC wins by over 3.5");
  assert.equal(L("KXMLBTEAMTOTAL", "San Diego over 7.5 runs scored"), "Team total: San Diego over 7.5 runs scored");
  assert.equal(L("KXNBA1Q", "Lakers"), "1st quarter winner: Lakers");
  assert.equal(L("KXMLBGAME", "Dodgers"), "Winner: Dodgers");
  assert.equal(L("KXATPGTOTAL", "Over 22.5 games"), "Total games: Over 22.5 games");
  assert.equal(L("KXMLBF5TOTAL", "First 5 innings: Over 6.5 runs"), "First 5 innings: Over 6.5 runs", "not said twice");
  assert.equal(L("KXGOLDH", "Above 2400"), "Above 2400", "non-sports markets unchanged");
});

test("P&L history fetches only fills newer than the stored copy", async () => {
  const { Cache } = await import("../src/lib/cache.ts");
  const fill = (id: string, ticker: string, at: string) => ({ fill_id: id, ticker, outcome_side: "yes", count_fp: "1", yes_price_dollars: "0.5", fee_cost: "0", created_time: at });
  let account = [fill("f1", "KXA-1-X", "2026-09-01T00:00:00Z"), fill("f2", "KXA-2-X", "2026-09-20T00:00:00Z")];
  const asked: URL[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string) => {
    const u = new URL(input);
    asked.push(u);
    if (u.pathname.endsWith("/portfolio/fills")) {
      const min = Number(u.searchParams.get("min_ts") || 0) * 1000;
      return Response.json({ fills: account.filter((f) => Date.parse(f.created_time) >= min), cursor: "" });
    }
    const tickers = (u.searchParams.get("tickers") || "").split(",").filter(Boolean);
    return Response.json({ markets: tickers.map((t) => ({ ticker: t, status: "finalized", result: "yes", settlement_ts: "2026-09-21T00:00:00Z" })) });
  }) as typeof fetch;
  Kalshi.setSigner(async () => ({ "KALSHI-ACCESS-KEY": "k" }));
  try {
    const cache = new Cache();
    const first = await Kalshi.history(cache);
    assert.deepEqual(first.fills.map((f) => f.id), ["f1", "f2"]);
    assert.equal(asked.find((u) => u.pathname.endsWith("/fills"))!.searchParams.get("min_ts"), null, "first time: everything");

    account = [...account, fill("f3", "KXA-3-X", "2026-10-01T00:00:00Z")];
    asked.length = 0;
    const second = await Kalshi.history(cache, first);
    const min = Number(asked.find((u) => u.pathname.endsWith("/fills"))!.searchParams.get("min_ts")) * 1000;
    assert.equal(min, Date.parse("2026-09-20T00:00:00Z") - 2 * 864e5, "from shortly before the newest stored fill");
    assert.deepEqual(second.fills.map((f) => f.id).sort(), ["f1", "f2", "f3"], "merged without duplicates");
    assert.ok(!asked.some((u) => (u.searchParams.get("tickers") || "").includes("KXA-1-X")), "settled results come from the cache");
  } finally {
    globalThis.fetch = realFetch;
    Kalshi.setSigner(null);
  }
});
