// Realized P&L from the user's fills (or Kalshi's "Realized P&L" CSV export). Pure functions, no I/O.
// Analytics only; nothing here is a trading recommendation.

import type { Fill, MarketResult, Trade } from "./types.ts";

const REQUIRED = ["market_ticker", "side", "quantity_fp", "entry_price_dollars", "exit_price_dollars",
  "realized_pnl_with_fees_dollars", "close_timestamp"];

/** RFC 4180-ish CSV: quoted fields, doubled quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Trades from Kalshi's realized P&L export. Only the columns the analysis needs are kept (no account ids). */
export function parseExport(text: string): Trade[] {
  const [header = [], ...lines] = parseCsv(String(text).replace(/^﻿/, ""));
  const col: Record<string, number> = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  const missing = REQUIRED.filter((k) => !(k in col));
  if (missing.length) throw new Error(`This isn't Kalshi's realized P&L export (missing ${missing.join(", ")}).`);
  const n = (r: string[], k: string) => (k in col ? Number(r[col[k]]) : NaN);
  return lines.map((r): Trade => {
    const ticker = r[col.market_ticker];
    const exit = n(r, "exit_price_dollars");
    return {
      ticker, side: r[col.side], qty: n(r, "quantity_fp"),
      entry: n(r, "entry_price_dollars"), exit,
      fees: (n(r, "open_fees_dollars") || 0) + (n(r, "close_fees_dollars") || 0),
      closeFees: n(r, "close_fees_dollars") || 0,
      pnl: n(r, "realized_pnl_with_fees_dollars"),
      gross: n(r, "realized_pnl_without_fees_dollars"),
      openedAt: Date.parse(r[col.open_timestamp]) || null,
      closedAt: Date.parse(r[col.close_timestamp]) || 0,
      combo: /^KXMVE/.test(ticker),
      // Held to settlement pays $1 or $0; anything else was sold before the result.
      result: exit >= 0.995 ? "won" : exit <= 0.005 ? "lost" : "exited",
    };
  }).filter((t) => t.ticker && Number.isFinite(t.qty) && Number.isFinite(t.pnl) && t.closedAt);
}

/** Held markets with no result yet; `known: false` = no public market data at all. */
export interface NotCounted { ticker: string; known: boolean; status: string | null }
export type Trades = Trade[] & { notCounted?: NotCounted[] };

/**
 * Closed trades from fills plus each market's public result. Buying YES and NO of the same market nets out to
 * $1 per pair, so per market: P&L = pairs × $1 + settlement payout − what was paid − fees, whatever the order.
 * Markets still held and unsettled are left out (not realized) and listed in `notCounted`.
 */
export function fromFills(fills: Fill[], markets: Map<string, MarketResult>): Trades {
  const by = new Map<string, { yes: number; no: number; yesCost: number; noCost: number; fees: number; first: number; last: number }>();
  for (const f of fills) {
    if (f.status && f.status !== "confirmed") continue;
    let g = by.get(f.market_ticker);
    if (!g) by.set(f.market_ticker, (g = { yes: 0, no: 0, yesCost: 0, noCost: 0, fees: 0, first: Infinity, last: 0 }));
    const n = Number(f.count_fp), px = Number(f.price_dollars), at = Date.parse(f.create_date);
    if (f.is_yes) { g.yes += n; g.yesCost += n * px; } else { g.no += n; g.noCost += n * px; }
    g.fees += Number(f.fee_dollars) || 0;
    g.first = Math.min(g.first, at); g.last = Math.max(g.last, at);
  }
  const out: Trades = [], open: NotCounted[] = [];
  for (const [ticker, g] of by) {
    const m = markets.get(ticker);
    const pairs = Math.min(g.yes, g.no), netYes = g.yes - pairs, netNo = g.no - pairs;
    // "scalar" = a partial payout, e.g. a tie settled 50/50: YES gets the settlement value, NO the rest.
    const scalar = m?.result === "scalar" && Number.isFinite(Number(m.settlement_value_dollars));
    const settled = !!m && (m.result === "yes" || m.result === "no" || scalar);
    const flat = netYes < 1e-9 && netNo < 1e-9;
    if (!settled && !flat) { open.push({ ticker, known: !!m, status: m?.status ?? null }); continue; }
    const yesValue = scalar ? Number(m!.settlement_value_dollars) : m?.result === "yes" ? 1 : 0;
    const payout = settled ? netYes * yesValue + netNo * (1 - yesValue) : 0;
    const cost = g.yesCost + g.noCost, paidIn = cost + g.fees, paidOut = pairs + payout;
    const side = g.yes >= g.no ? "yes" : "no";
    const qty = side === "yes" ? g.yes : g.no;
    const held = netYes + netNo > 1e-9;
    out.push({
      ticker, side, qty, combo: /^KXMVE/.test(ticker),
      entry: qty ? (side === "yes" ? g.yesCost : g.noCost) / qty : 0,
      exit: qty ? paidOut / qty : 0,
      in: paidIn, out: paidOut, fees: g.fees, closeFees: 0,
      pnl: paidOut - paidIn, gross: paidOut - cost,
      openedAt: g.first,
      closedAt: settled ? Date.parse(m!.settlement_ts || m!.expiration_time || m!.close_time || "") || g.last : g.last,
      result: !held ? "exited" : scalar ? (paidOut - paidIn >= 0 ? "won" : "lost") : payout > 0 ? "won" : "lost",
    });
  }
  out.sort((a, b) => a.closedAt - b.closedAt);
  out.notCounted = open;
  return out;
}

const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + (f(x) || 0), 0);

/** Money in (price paid + fees) and out (payout or sale, minus fees) for one trade. */
export const inOut = (t: Trade): { in: number; out: number } => (t.in != null && t.out != null ? { in: t.in, out: t.out }
  : { in: t.entry * t.qty + (t.fees - (t.closeFees ?? 0)), out: t.exit * t.qty - (t.closeFees ?? 0) });

/** Average return = mean over trades of P&L ÷ money in (fees included), so each trade counts equally. */
export function avgReturn(trades: Trade[]): number | null {
  const rs = trades.map((t) => t.pnl / inOut(t).in).filter(Number.isFinite);
  return rs.length ? rs.reduce((a, r) => a + r, 0) / rs.length : null;
}

export interface Summary {
  count: number; pnl: number; fees: number; staked: number; roi: number | null;
  won: number; lost: number; exited: number; hitRate: number | null; avgRet: number | null;
}

export function summary(trades: Trade[]): Summary {
  const settled = trades.filter((t) => t.result !== "exited");
  const won = settled.filter((t) => t.result === "won").length;
  const staked = sum(trades, (t) => t.entry * t.qty);
  const pnl = sum(trades, (t) => t.pnl), fees = sum(trades, (t) => t.fees);
  return {
    count: trades.length, pnl, fees, staked,
    roi: staked ? pnl / staked : null,
    won, lost: settled.length - won, exited: trades.length - settled.length,
    hitRate: settled.length ? won / settled.length : null,
    avgRet: avgReturn(trades),
  };
}

/** Trades closed in [from, to). `from = null` means since the beginning. */
export const inRange = (trades: Trade[], from: number | null, to = Infinity): Trade[] =>
  trades.filter((t) => (from == null || t.closedAt >= from) && t.closedAt < to);

/** Running total by close time, for the chart. Each point keeps its trade. */
export function cumulative(trades: Trade[]): { t: number; total: number; trade: Trade }[] {
  let total = 0;
  return [...trades].sort((a, b) => a.closedAt - b.closedAt).map((trade) => ({ t: trade.closedAt, total: (total += trade.pnl), trade }));
}
