// The side drawer: one position's picks, odds at buy vs. now, and money. Settings also open in it.

import { $, esc, num } from "./dom.ts";
import { type CalEvent, eventNames, legTime, matchup } from "./events.ts";
import { money, pct, when } from "./format.ts";
import { tags } from "./views.ts";
import type { Leg } from "../lib/types.ts";

const legUrl = (l: Leg) => `https://kalshi.com/markets/${l.series.toLowerCase()}/${l.eventTicker.toLowerCase()}`;

/** Which entry the drawer shows, so clicking it again closes it. */
let openKey: string | null = null;

export function openDrawer(html: string, key: string | null = null): void {
  openKey = key;
  $("#detail").innerHTML = html;
  $("#drawer").hidden = false;
}
export function closeDetail(): void {
  $("#drawer").hidden = true;
  openKey = null;
}
export const drawerOpen = (): boolean => !$("#drawer").hidden;

export function toggleDetail(e: CalEvent): void {
  const key = `${e.item.ticker}@${e.ts}`;
  if (drawerOpen() && openKey === key) return closeDetail();
  openDrawer(detailHtml(e), key);
}

function detailHtml(e: CalEvent): string {
  const it = e.item;
  const legs = [...it.legs].sort((a, b) => (legTime(a) ?? 0) - (legTime(b) ?? 0)).map((l, i) => `
    <div class="leg ${l.outcome}">
      <div class="top">
        <strong>${num(i + 1)} ${l.side === "no" ? "NO · " : ""}${esc(l.title)}</strong>
        <span class="odds">${l.probAtBuy != null ? `<span class="was">${pct(l.probAtBuy)}</span> → ` : ""}${l.outcome === "pending" ? (l.prob != null ? pct(l.prob) : "–") : `<span class="tag ${l.outcome}">${l.outcome}</span>`}</span>
      </div>
      <div class="sub">${tags([l])} ${esc(matchup(l))} · ${legTime(l) ? when(legTime(l)) : "time unknown"}</div>
      <a href="${esc(legUrl(l))}" target="_blank" rel="noopener">Game market ↗</a>
    </div>`).join("");

  // Chance now: legs multiplied for combos (won legs count as 100%), live market price for singles.
  const nowP = it.isCombo
    ? (it.legs.every((l) => l.prob != null || l.outcome === "won") ? it.legs.reduce((a, l) => a * (l.outcome === "won" ? 1 : l.prob!), 1) : null)
    : it.legs[0].prob;
  const cell = (v: string | null) => (v == null ? "–" : v);
  const cost = it.cost ?? it.exposure;

  return `
    <div class="d-when">${when(e.ts)}</div>
    <h2>${eventNames(it.legs).map(esc).join("<br>")}</h2>
    <div class="d-money"><b>${money(cost)}</b> to win <b>${money(it.payout)}</b>${it.cost ? ` <span class="sub">(${(it.payout / it.cost).toFixed(2)}x)</span>` : ""}
      <span class="tag ${it.state}">${it.state}</span></div>
    <h3>${it.isCombo ? `Your picks (${it.legs.length})` : "Your pick"} <span class="sub">${it.legs.some((l) => l.probAtBuy != null) ? "chance at buy → now" : "chance now"}</span></h3>
    ${legs}
    <table class="stats">
      <thead><tr><th></th><th>Bought</th><th>Now</th></tr></thead>
      <tbody>
        <tr><th>Chance${it.isCombo ? " (all legs)" : ""}</th><td>${cell(it.avgPrice != null ? pct(it.avgPrice) : null)}</td><td>${cell(nowP != null ? pct(nowP) : null)}</td></tr>
        <tr><th>Contract price</th><td>${cell(it.avgPrice != null ? money(it.avgPrice) : null)}</td><td>${cell(nowP != null ? money(nowP) : null)}</td></tr>
        <tr><th>Position value</th><td>${money(cost)}</td><td>${cell(nowP != null ? money(nowP * it.contracts) : null)}</td></tr>
      </tbody>
      <tbody class="meta">
        <tr><th>Contracts</th><td colspan="2">${it.contracts} ${it.userSide.toUpperCase()}</td></tr>
        <tr><th>Pays if it hits</th><td colspan="2">${money(it.payout)}</td></tr>
        <tr><th>Settles by</th><td colspan="2">${when(it.settleBy)}</td></tr>
        <tr><th>Ticker</th><td colspan="2" class="tk">${esc(it.ticker)}</td></tr>
      </tbody>
    </table>`;
}
