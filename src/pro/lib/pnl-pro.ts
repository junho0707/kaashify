// Pro P&L analytics: the breakdown (combos by legs → sport, singles by sport → market kind), the trade table rows
// and their CSV export. Pure functions, no I/O. Analytics only; nothing here is a trading recommendation.

import { categoryOf, seriesOf } from "../../lib/markets.ts";
import { type Summary, inOut, summary } from "../../lib/pnl.ts";
import type { Trade } from "../../lib/types.ts";

/** Combo ticker → its legs' market tickers, once loaded (so combos can be split by size and sport). */
export type ComboLegs = Map<string, string[]>;
export interface Group<K = string> extends Summary { key: K }
export interface SportRow extends Group { worked: Group[]; didnt: Group[]; best: Trade | null; worst: Trade | null }
export interface Breakdown extends Group { groups?: (Group & { sports: SportRow[] })[]; sports?: SportRow[] }

export function groupBy<K>(trades: Trade[], keyOf: (t: Trade) => K | null | undefined): Group<K>[] {
  const m = new Map<K, Trade[]>();
  for (const t of trades) {
    const k = keyOf(t);
    if (k == null) continue;
    let list = m.get(k);
    if (!list) m.set(k, (list = []));
    list.push(t);
  }
  return [...m].map(([key, ts]) => ({ key, ...summary(ts) })).sort((a, b) => b.count - a.count);
}

// Market kind from the series suffix; the longest matching suffix wins ("1HSPREAD" over "SPREAD", "MATCH" over "H").
const KINDS: [string, string][] = ([["1QSPREAD", "1st-quarter spread"], ["1QTOTAL", "1st-quarter total"], ["1HSPREAD", "1st-half spread"],
  ["1HTOTAL", "1st-half total"], ["F5SPREAD", "First-5 spread"], ["F5TOTAL", "First-5 total"], ["TEAMTOTAL", "Team total"],
  ["GSPREAD", "Games spread"], ["GTOTAL", "Total games"], ["SETWINNER", "Set winner"], ["EXACTMATCH", "Exact score"],
  ["SPREAD", "Spread"], ["TOTAL", "Total"], ["1Q", "1st-quarter winner"], ["1H", "1st-half winner"], ["F5", "First-5 winner"],
  ["15M", "15-minute price"], ["H", "Hourly price"], ["GAME", "Winner"], ["MATCH", "Winner"], ["FIGHT", "Winner"]] as [string, string][])
  .sort((a, b) => b[0].length - a[0].length);

const byPnl = (a: Group, b: Group) => b.pnl - a.pnl;
const sportOfCombo = (legs: string[]) => {
  const sports = [...new Set(legs.map(categoryOf))];
  return sports.length === 1 ? sports[0] : "Mixed";
};

/** "NFL · winner", "MLB · first-5 total"; combos → their sport ("Mixed" across several), or "Combo" before legs load. */
export function kindOf(t: Pick<Trade, "ticker"> & { combo?: boolean }, comboLegs?: ComboLegs): string {
  if (t.combo) {
    const legs = comboLegs?.get(t.ticker);
    return legs?.length ? sportOfCombo(legs) : "Combo";
  }
  const s = seriesOf(t.ticker);
  const k = KINDS.find(([suf]) => s.endsWith(suf) && s.length > suf.length);
  if (!k) return s;
  // Keep the league when a category has several ("WTA winner" vs "ITF winner").
  return `${s.slice(0, -k[0].length)} · ${k[1].toLowerCase()}`;
}

/** Per sport: totals, the market kinds that worked and didn't, and the best and worst trade. */
function sportRows(ts: Trade[], sportOf: (t: Trade) => string, comboLegs?: ComboLegs): SportRow[] {
  return groupBy(ts, sportOf).map((g) => {
    const mine = ts.filter((t) => sportOf(t) === g.key);
    const kinds = groupBy(mine, (t) => kindOf(t, comboLegs)).sort(byPnl);
    const ranked = [...mine].sort((a, b) => b.pnl - a.pnl);
    const combo = mine[0].combo;
    return { ...g, worked: combo ? [] : kinds.filter((k) => k.pnl > 0), didnt: combo ? [] : kinds.filter((k) => k.pnl <= 0).reverse(),
      best: ranked[0]?.pnl > 0 ? ranked[0] : null, worst: (ranked.at(-1)?.pnl ?? 0) < 0 ? ranked.at(-1)! : null };
  }).sort(byPnl);
}

/** Combos (by number of legs, then sport) and individual bets (by sport). */
export function breakdown(trades: Trade[], comboLegs?: ComboLegs): Breakdown[] {
  const out: Breakdown[] = [];
  const combos = trades.filter((t) => t.combo), singles = trades.filter((t) => !t.combo);
  if (combos.length) {
    const legsOf = (t: Trade) => comboLegs?.get(t.ticker)?.length || 0;
    const groups = groupBy(combos, legsOf).sort((a, b) => (a.key || 99) - (b.key || 99)).map((g) => ({
      ...g, key: g.key ? `${g.key} legs` : "Legs not loaded yet",
      sports: sportRows(combos.filter((t) => legsOf(t) === g.key), (t) => kindOf(t, comboLegs), comboLegs),
    }));
    out.push({ key: "Combos", ...summary(combos), groups });
  }
  if (singles.length) out.push({ key: "Individual bets", ...summary(singles), sports: sportRows(singles, (t) => categoryOf(t.ticker), comboLegs) });
  return out;
}

export interface TradeRow {
  t: Trade; closed: Date; name: string; ticker: string; type: "Combo" | "Single"; side: string; qty: number;
  in: number; out: number; pnl: number; ret: number | null; result: string;
}

/** One row per trade, newest first, for the trade table and its CSV export. nameOf: a readable name. */
export function tradeRows(trades: Trade[], nameOf: (t: Trade) => string = (t) => t.ticker): TradeRow[] {
  return [...trades].sort((a, b) => b.closedAt - a.closedAt).map((t) => {
    const io = inOut(t);
    return { t, closed: new Date(t.closedAt), name: nameOf(t), ticker: t.ticker, type: t.combo ? "Combo" : "Single",
      side: t.side, qty: t.qty, in: io.in, out: io.out, pnl: t.pnl, ret: io.in ? t.pnl / io.in : null,
      result: t.result === "exited" ? "sold early" : t.result };
  });
}

export function toCsv(rows: TradeRow[]): string {
  const q = (v: unknown) => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const n2 = (x: number | null) => (x != null && Number.isFinite(x) ? x.toFixed(2) : "");
  const head = ["closed", "market", "ticker", "type", "side", "contracts", "money_in", "money_out", "pnl", "return_pct", "result"];
  return [head, ...rows.map((r) => [r.closed.toISOString(), r.name, r.ticker, r.type, r.side, +r.qty.toFixed(2), n2(r.in), n2(r.out),
    n2(r.pnl), r.ret == null ? "" : (r.ret * 100).toFixed(1), r.result])].map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
}
