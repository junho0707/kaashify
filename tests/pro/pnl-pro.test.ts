import { test } from "node:test";
import assert from "node:assert/strict";
import { parseExport } from "../../src/lib/pnl.ts";
import * as Pro from "../../src/pro/lib/pnl-pro.ts";
import { CSV } from "../export-csv.ts";

test("breakdown: combos by legs then sport, singles by sport, with average return", () => {
  const t = parseExport(CSV);
  const legs = new Map([["KXMVECROSSCATEGORY-S1-A", ["KXNFLGAME-X-KC", "KXMLBGAME-Y-LAD", "KXNFLSPREAD-X-KC3"]],
    ["KXMVECROSSCATEGORY-S1-B", ["KXNFLGAME-Z-KC", "KXNFLSPREAD-Z-KC3"]]]);
  const [combos, singles] = Pro.breakdown(t, legs);
  assert.equal(combos.key, "Combos"); assert.equal(combos.count, 2);
  assert.deepEqual(combos.groups!.map((g) => [g.key, g.sports.map((s) => s.key)]), [["2 legs", ["Football"]], ["3 legs", ["Mixed"]]]);
  assert.equal(combos.groups![0].sports[0].best!.ticker, "KXMVECROSSCATEGORY-S1-B");
  assert.equal(singles.key, "Individual bets");
  assert.deepEqual(singles.sports!.map((s) => s.key), ["Football", "Commodities"]);
  assert.deepEqual(singles.sports![0].worked.map((k) => k.key), ["NFL · winner"]);
  // Average return: mean of P&L ÷ money in. S1-B: 15.95 / (4 + 0.05) ≈ 3.94; S1-A: −1.02 / 1.02 = −1.
  assert.equal(+combos.avgRet!.toFixed(3), +((15.95 / 4.05 - 1) / 2).toFixed(3));
  // Without legs yet, combos sit in one group.
  assert.deepEqual(Pro.breakdown(t)[0].groups!.map((g) => g.key), ["Legs not loaded yet"]);
});

test("market kinds from series suffixes", () => {
  const k = (s: string) => Pro.kindOf({ ticker: `KX${s}-X` });
  assert.equal(k("NFLGAME"), "NFL · winner");
  assert.equal(k("GOLD15M"), "GOLD · 15-minute price");
  assert.equal(k("NFL1QSPREAD"), "NFL · 1st-quarter spread");
  assert.equal(k("MLBF5TOTAL"), "MLB · first-5 total");
  assert.equal(k("MLBTEAMTOTAL"), "MLB · team total");
  assert.equal(k("NCAAF1H"), "NCAAF · 1st-half winner");
  assert.equal(k("WTAMATCH"), "WTA · winner");
  assert.equal(k("GOLDH"), "GOLD · hourly price");
});

test("trade rows (newest first) and CSV export", () => {
  const t = parseExport(CSV);
  const rows = Pro.tradeRows(t, (x) => (x.combo ? "Lakers, + Over" : x.ticker));
  assert.equal(rows[0].ticker, "KXMVECROSSCATEGORY-S1-B");
  assert.equal(rows.at(-1)!.ticker, "KXNFLGAME-26SEP07KCLV-KC");
  const csv = Pro.toCsv(rows).split("\r\n");
  assert.equal(csv[0], "closed,market,ticker,type,side,contracts,money_in,money_out,pnl,return_pct,result");
  assert.match(csv[1], /^2026-09-17T00:00:00\.000Z,"Lakers, \+ Over",KXMVECROSSCATEGORY-S1-B,Combo,yes,20,4\.05,20\.00,15\.95,393\.8,won$/);
  assert.match(csv[2], /,Single,yes,5,2\.01,2\.75,0\.74,36\.8,sold early$/);
  assert.equal(csv.length, 7);
});
