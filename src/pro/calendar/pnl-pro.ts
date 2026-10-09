// P&L details: every trade in a table (with CSV export) and the breakdown, for the selected range (presets or a
// zoomed Custom range), plus readable trade names in the table, breakdown and chart tooltips.

import { setTradeNamer } from "../../calendar/chart.ts";
import { $maybe, download, esc } from "../../calendar/dom.ts";
import { fmt, money, pnlCls, signed } from "../../calendar/format.ts";
import { pnlHooks } from "../../calendar/pnl-view.ts";
import type { Trade } from "../../lib/types.ts";
import type { TradeInfo } from "../lib/kalshi-pro.ts";
import { type ComboLegs, type Group, type LegKind, type SportRow, breakdown, toCsv, tradeRows } from "../lib/pnl-pro.ts";
import type { TradeInfoResult } from "../types.ts";
import { send } from "./send.ts";

/** Trades in the selected range, as drawn (the CSV exports exactly these). */
let shown: Trade[] = [];
/** Readable names and combo legs, filled in from public market data after the first draw. */
const info: Record<string, TradeInfo> = {};

/** "LAD vs ATL: Los Angeles D"; a combo is its picks joined with "+"; the ticker until names load. */
export function tradeName(t: Trade): string {
  const i = info[t.ticker];
  if (i?.legs) return i.legs.map((l) => `${l.side === "no" ? "NO " : ""}${l.pick}`).join(" + ");
  if (i) return `${i.event}: ${t.side === "no" ? "NO " : ""}${i.pick}`;
  return t.ticker;
}

/** Chart tooltip lines: the event, then each pick; a combo lists its legs under their events. */
export function tradeLines(t: Trade): string[] {
  const i = info[t.ticker];
  if (!i) return [t.ticker];
  const side = (s: string) => (s === "no" ? "NO " : "");
  if (!i.legs) return [i.event, `${side(t.side)}${i.pick}`];
  const byEvent = new Map<string, string[]>();
  for (const l of i.legs) byEvent.set(l.event, [...(byEvent.get(l.event) ?? []), `${side(l.side)}${l.pick}`]);
  const lines = [`Combo · ${i.legs.length} legs`];
  for (const [ev, picks] of byEvent) lines.push(`${ev}: ${picks.join(", ")}`);
  return lines;
}

/** Return % with a sign, e.g. "+12%" / "−8%". */
const signedPct = (r: number | null) => (r == null ? "–" : `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.round(Math.abs(r) * 100)}%`);
const sold = (g: Group) => (g.exited ? ` · ${g.exited} sold` : "");
const kindRow = (k: Group) => `<li><span class="k">${esc(k.key)}</span><span class="sub">${k.won}–${k.lost}${sold(k)} · avg ${signedPct(k.avgRet)}</span><b class="${pnlCls(k.pnl)}">${signed(k.pnl)}</b></li>`;
const tradeLine = (label: string, t: Trade | null) => (t ? `<li><span class="k">${label}: ${esc(tradeName(t))}</span><span class="sub">${fmt.dayShort.format(t.closedAt)}</span><b class="${pnlCls(t.pnl)}">${signed(t.pnl)}</b></li>` : "");
const statLine = (g: Group) => `${g.count} trade${g.count === 1 ? "" : "s"} · ${g.won}–${g.lost}${sold(g)} · <span class="${pnlCls(g.avgRet)}" title="Average return per trade: P&amp;L ÷ money in, fees included">avg ${signedPct(g.avgRet)}</span>`;
const catRow = (g: Group, max: number, depth: number, body: string) => `<details class="cat d${depth}"${depth === 0 ? " open" : ""}>
    <summary>
      <span class="name">${esc(g.key)}</span>
      <span class="sub">${statLine(g)}</span>
      <span class="meter"><i class="${pnlCls(g.pnl)}" style="width:${(Math.abs(g.pnl) / max) * 100}%"></i></span>
      <b class="${pnlCls(g.pnl)}">${signed(g.pnl)}</b>
    </summary>
    <div class="cat-body">${body}</div>
  </details>`;
const legRow = (k: LegKind) => {
  const n = k.hit + k.missed, rate = n ? k.hit / n : null;
  return `<li><span class="k">${esc(k.key)}</span><span class="sub">${k.hit} hit · ${k.missed} missed${k.open ? ` · ${k.open} open` : ""}</span><b class="${rate == null ? "" : pnlCls(rate - 0.5)}">${rate == null ? "–" : `${Math.round(rate * 100)}%`}</b></li>`;
};
const tradeItem = (t: Trade) => `<li><span class="k">${esc(tradeName(t))}</span><span class="sub">${fmt.dayShort.format(t.closedAt)} · ${t.result === "exited" ? "sold" : t.result}</span><b class="${pnlCls(t.pnl)}">${signed(t.pnl)}</b></li>`;
const sportBody = (c: SportRow) => {
  const combo = c.trades[0]?.combo;
  return `${c.worked.length ? `<h4>${combo ? "Leg mixes that worked" : "Worked"}</h4><ul>${c.worked.map(kindRow).join("")}</ul>` : ""}
      ${c.didnt.length ? `<h4>${combo ? "Leg mixes that didn't" : "Didn't work"}</h4><ul>${c.didnt.map(kindRow).join("")}</ul>` : ""}
      ${c.legKinds.length ? `<h4>Leg hit rate by type <span class="sub">worst first</span></h4><ul>${c.legKinds.map(legRow).join("")}</ul>` : ""}
      <h4>Standouts</h4><ul>${tradeLine("Best", c.best)}${tradeLine("Worst", c.worst)}</ul>
      <details class="all-trades"><summary>All ${c.trades.length} trade${c.trades.length === 1 ? "" : "s"}</summary><ul>${c.trades.map(tradeItem).join("")}</ul></details>`;
};

const comboLegs = (): ComboLegs => new Map(Object.entries(info).filter(([, v]) => v.legs)
  .map(([k, v]) => [k, v.legs!.map((l) => ({ ticker: l.market_ticker, side: l.side, result: l.result }))]));

/** Combos (by number of legs, then sport) and individual bets (by sport). */
export function categoryList(trades: Trade[]): string {
  const top = breakdown(trades, comboLegs());
  const all = top.flatMap((c) => [c, ...(c.groups ?? []), ...(c.groups ?? []).flatMap((g) => g.sports), ...(c.sports ?? [])]);
  const max = Math.max(...all.map((c) => Math.abs(c.pnl)), 1);
  const sports = (rows: SportRow[], depth: number) => rows.map((r) => catRow(r, max, depth, sportBody(r))).join("");
  return top.map((c) => catRow(c, max, 0, c.groups
    ? c.groups.map((g) => catRow(g, max, 1, sports(g.sports, 2))).join("")
    : sports(c.sports ?? [], 1))).join("");
}

export function tradeTable(trades: Trade[]): string {
  return `<table class="stats trade-table"><thead><tr><th>Closed</th><th>Market</th><th>In</th><th>Out</th><th>P&amp;L</th><th>Return</th></tr></thead><tbody>
    ${tradeRows(trades, tradeName).map((r) => `<tr>
      <td>${fmt.dayShort.format(r.closed)}</td>
      <td><span class="mk">${esc(r.name)}</span><span class="sub">${r.type} · ${r.result}</span></td>
      <td>${money(r.in)}</td><td>${money(r.out)}</td>
      <td class="${pnlCls(r.pnl)}">${signed(r.pnl)}</td><td class="${pnlCls(r.ret)}">${signedPct(r.ret)}</td></tr>`).join("")}
  </tbody></table>`;
}

function sections(t: Trade[]): string {
  return `<section class="pnl-sec"><h3>Trades <span class="sub">every closed trade in this range, newest first</span><button class="linkbtn" id="pnl-export">Export CSV</button></h3>
      <details class="trades"><summary>Show all ${t.length} trades</summary><div id="trades">${tradeTable(t)}</div></details></section>
    <section class="pnl-sec"><h3>Breakdown <span class="sub">avg = average return per trade · open a row for more</span></h3><div id="cats">${categoryList(t)}</div></section>`;
}

export function exportTrades(): void {
  download(`kaashify-trades-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(tradeRows(shown, tradeName)), "text/csv");
}

/** Redraws the table and breakdown with names, keeping open rows open. */
function fillNames(): void {
  const cats = $maybe("#cats");
  if (!cats) return;
  const path = (d: Element): string => {
    const names: string[] = [];
    for (let p: Element | null = d; p && p !== cats; p = p.parentElement?.closest("#cats details") ?? null) {
      names.push(p.querySelector(":scope > summary .name")?.textContent ?? "");
    }
    return names.join("/");
  };
  const open = new Map([...cats.querySelectorAll<HTMLDetailsElement>("details")].map((d) => [path(d), d.open]));
  cats.innerHTML = categoryList(shown);
  const table = $maybe("#trades");
  if (table) table.innerHTML = tradeTable(shown);
  cats.querySelectorAll<HTMLDetailsElement>("details").forEach((d) => { const o = open.get(path(d)); if (o != null) d.open = o; });
}

/** Names come from public market data: the page first renders with tickers, then fills in what's missing. */
async function loadNames(trades: Trade[]): Promise<void> {
  const missing = [...new Set(trades.map((t) => t.ticker).filter((x) => !info[x]))];
  if (!missing.length) return;
  const r = await send<TradeInfoResult>({ type: "trade-info", tickers: missing }).catch(() => null);
  if (!r?.ok) return;
  Object.assign(info, r.info);
  if (shown === trades) fillNames();
}

export function initPnlPro(): void {
  setTradeNamer(tradeLines);
  pnlHooks.sections = sections;
  pnlHooks.drawn = (t) => {
    shown = t;
    if (t.length) void loadNames(t); // names for the chart tooltip on every plan
  };
  document.addEventListener("click", (e) => { if ((e.target as Element).id === "pnl-export") exportTrades(); });
}
