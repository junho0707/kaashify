import { test } from "node:test";
import assert from "node:assert/strict";
import * as Pnl from "../src/lib/pnl.ts";
import type { Fill, MarketResult, Trade } from "../src/lib/types.ts";

// Synthetic rows in the column layout of Kalshi's realized P&L export.
const HEAD = "subtrader_id,type,quantity_fp,market_ticker,side,entry_price_dollars,exit_price_dollars,open_fees_dollars,close_fees_dollars,realized_pnl_without_fees_dollars,realized_pnl_with_fees_dollars,close_timestamp,open_timestamp";
const row = (q: number, t: string, side: string, entry: number, exit: number, fee: number, gross: number, net: number, close: string) => `00000000-0000-0000-0000-000000000000,trade,${q},${t},${side},${entry},${exit},${fee},0,${gross},${net},${close},2026-09-01T10:00:00-04:00`;
const CSV = [HEAD,
  row(10, "KXNFLGAME-26SEP07KCLV-KC", "yes", 0.6, 1, 0.1, 4, 3.9, "2026-09-07T20:00:00-04:00"),
  row(10, "KXNFLGAME-26SEP14KCLV-KC", "no", 0.3, 0, 0.1, -3, -3.1, "2026-09-14T20:00:00-04:00"),
  row(20, "KXMVECROSSCATEGORY-S1-A", "yes", 0.05, 0, 0.02, -1, -1.02, "2026-09-15T20:00:00-04:00"),
  row(20, "KXMVECROSSCATEGORY-S1-B", "yes", 0.2, 1, 0.05, 16, 15.95, "2026-09-16T20:00:00-04:00"),
  row(5, "KXGOLD15M-26SEP161015-T1", "yes", 0.4, 0.55, 0.01, 0.75, 0.74, "\"2026-09-16T10:15:00-04:00\""),
].join("\r\n") + "\r\n";

test("parses the export and drops account ids", () => {
  const t = Pnl.parseExport("﻿" + CSV);
  assert.equal(t.length, 5);
  assert.deepEqual(t.map((x) => x.result), ["won", "lost", "lost", "won", "exited"]);
  assert.equal(t[4].closedAt, Date.parse("2026-09-16T10:15:00-04:00"));
  assert.ok(!JSON.stringify(t).includes("00000000-0000"));
});

test("rejects other files", () => {
  assert.throws(() => Pnl.parseExport("a,b\n1,2"), /isn't Kalshi's realized P&L export/);
});

test("summary, series and cumulative", () => {
  const t = Pnl.parseExport(CSV);
  const s = Pnl.summary(t);
  assert.equal(s.count, 5);
  assert.equal(+s.pnl.toFixed(2), 16.47);
  assert.equal(+s.fees.toFixed(2), 0.28);
  assert.equal(s.won, 2); assert.equal(s.lost, 2); assert.equal(s.exited, 1);
  assert.equal(s.hitRate, 0.5);
  assert.equal(+Pnl.cumulative(t).at(-1)!.total.toFixed(2), 16.47);
});

test("money in and out match the export's P&L with fees", () => {
  const [won] = Pnl.parseExport(CSV);
  const io = Pnl.inOut(won);
  assert.equal(+(io.out - io.in).toFixed(2), won.pnl);
});

test("live P&L from fills: settled, sold early, and still open", () => {
  const fill = (t: string, isYes: boolean, n: number, px: number, fee: number, at: string): Fill =>
    ({ market_ticker: t, is_yes: isYes, count_fp: String(n), price_dollars: px, fee_dollars: fee, create_date: at, status: "confirmed" });
  const fills = [
    fill("KXMVE-S1-A", true, 10, 0.2, 0.1, "2026-10-01T10:00:00Z"),          // combo held, hit
    fill("KXNFLGAME-X-KC", true, 10, 0.6, 0.1, "2026-10-02T10:00:00Z"),      // held, lost
    fill("KXGOLD-Y-T1", true, 5, 0.4, 0.01, "2026-10-03T10:00:00Z"),         // bought YES...
    fill("KXGOLD-Y-T1", false, 5, 0.45, 0.01, "2026-10-03T11:00:00Z"),       // ...sold (as NO): 5 pairs = $5 back
    fill("KXNBA-Z-LAL", true, 3, 0.5, 0.02, "2026-10-04T10:00:00Z"),         // still open
  ];
  const markets = new Map<string, MarketResult>([
    ["KXMVE-S1-A", { status: "finalized", result: "yes", settlement_ts: "2026-10-01T20:00:00Z" }],
    ["KXNFLGAME-X-KC", { status: "finalized", result: "no", close_time: "2026-10-02T23:00:00Z" }],
    ["KXGOLD-Y-T1", { status: "active", result: "" }],
    ["KXNBA-Z-LAL", { status: "active", result: "" }],
  ]);
  const t = Pnl.fromFills(fills, markets);
  assert.deepEqual(t.map((x) => [x.ticker, x.result, +x.pnl.toFixed(2)]), [
    ["KXMVE-S1-A", "won", 7.9], ["KXNFLGAME-X-KC", "lost", -6.1], ["KXGOLD-Y-T1", "exited", 0.73]]);
  assert.equal(+Pnl.summary(t).fees.toFixed(2), 0.22);
  assert.deepEqual(Pnl.inOut(t[0]), { in: 2.1, out: 10 });
});

test("a tie settled 50/50 counts, at half the payout", () => {
  const fills: Fill[] = [{ market_ticker: "KXKBOGAME-X-KTW", is_yes: true, count_fp: "2.7", price_dollars: 0.5, fee_dollars: 0.1, create_date: "2026-10-04T08:00:00Z", status: "confirmed" }];
  const markets = new Map<string, MarketResult>([["KXKBOGAME-X-KTW", { status: "finalized", result: "scalar", settlement_value_dollars: "0.5000", settlement_ts: "2026-10-04T12:45:57Z" }]]);
  const [t] = Pnl.fromFills(fills, markets);
  assert.equal(+t.out!.toFixed(2), 1.35);
  assert.equal(+t.pnl.toFixed(2), -0.1);
  assert.equal(Pnl.fromFills(fills, markets).notCounted!.length, 0);
});

test("inRange keeps trades closed inside the window", () => {
  const t = [{ closedAt: 100 }, { closedAt: 200 }, { closedAt: 300 }] as Trade[];
  assert.deepEqual(Pnl.inRange(t, null).map((x) => x.closedAt), [100, 200, 300]);
  assert.deepEqual(Pnl.inRange(t, 200).map((x) => x.closedAt), [200, 300]);
  assert.deepEqual(Pnl.inRange(t, 150, 300).map((x) => x.closedAt), [200]);
});
