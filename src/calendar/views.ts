// The calendar views (today / day / week / month / year / upcoming) and the summary line above them.
// Each view returns HTML; clicking an entry finds it again through `evIndex`.

import { categoryOf } from "../lib/markets.ts";
import type { Item, Leg } from "../lib/types.ts";
import { esc, num } from "./dom.ts";
import { type CalEvent, buildEvents, byDay, eventsOn, isLive, isOpen, isUnsettled, numbered, todayEvents } from "./events.ts";
import { addDays, fmt, money, sameDay, startOfDay, startOfWeek, when } from "./format.ts";
import { type ViewName, prefs, state } from "./state.ts";
import { watchViewHtml } from "./watch-view.ts";

/** Entries drawn in the current render, by their data-ev number. */
export let evIndex: CalEvent[] = [];
export const resetEvIndex = () => void (evIndex = []);

// Which sport (or other category) a leg lives in: from its ticker, else Kalshi's event category.
const legCat = (l: Leg): string | null => { const c = categoryOf(l.ticker || l.series || ""); return c === "Other" ? l.category || null : c; };
// One hue per category so tags read at a glance; anything else stays neutral.
const CAT_HUE: Record<string, number> = { Baseball: 0, Football: 20, Basketball: 40, Commodities: 55, Tennis: 78, Rugby: 100, Soccer: 125,
  Golf: 150, Cricket: 172, Hockey: 195, Volleyball: 215, Markets: 235, Esports: 275, Racing: 300, Fighting: 335 };
export const tags = (legs: Leg[]): string => [...new Set(legs.map(legCat).filter((c): c is string => !!c))]
  .map((c) => `<span class="stag"${c in CAT_HUE ? ` style="--c:${CAT_HUE[c]}"` : ""}>${esc(c)}</span>`).join("");
const costOf = (it: Item): number => it.cost ?? it.exposure ?? 0;
const stake = (it: Item): string => `${money(costOf(it))} → ${money(it.payout)}`;

const timeOf = (e: CalEvent): string => `${fmt.time.format(e.ts)}${e.approx ? "~" : ""}`;
/** Time slot of a card/row: LIVE, "Pending" for carry-overs from earlier days, else the time. */
const whenCell = (e: CalEvent): string => (isLive(e) ? `<span class="live">LIVE</span>`
  : e.ts < +startOfDay(new Date()) && isUnsettled(e) ? `<span class="pend" title="${esc(when(e.ts))}">Pending</span>` : timeOf(e));

function chip(e: CalEvent): string {
  evIndex.push(e);
  return `<button class="chip ${e.cls}" data-ev="${evIndex.length - 1}" title="${esc(`${e.label} · ${stake(e.item)}`)}">
    ${num(e.n)}<span class="tm">${timeOf(e)}</span><span class="lbl">${esc(e.label)}</span></button>`;
}
function row(e: CalEvent): string {
  evIndex.push(e);
  return `<button class="row ${e.cls}" data-ev="${evIndex.length - 1}">
    ${num(e.n)}<span class="tm">${whenCell(e)}</span><span class="ev-wrap"><span class="ev">${esc(e.label)}</span>${tags(e.item.legs)}</span><span class="mn">${stake(e.item)}</span></button>`;
}
function card(e: CalEvent): string {
  evIndex.push(e);
  const it = e.item;
  return `<button class="card ${e.cls}" data-ev="${evIndex.length - 1}">
    ${num(e.n)}<span class="when">${whenCell(e)}</span>
    <span class="what-wrap"><span class="what">${esc(e.label)}</span>${tags(it.legs)}</span>
    <span class="money"><b>${money(costOf(it))}</b> <span class="to">to win</span> <b>${money(it.payout)}</b></span>
  </button>`;
}

function daySummary(list: CalEvent[]): string {
  if (!list.length) return "";
  const cost = list.reduce((a, { item }) => a + costOf(item), 0);
  const pay = list.reduce((a, { item }) => a + (item.payout ?? 0), 0);
  return `<b>${list.length}</b> ${list.length === 1 ? "position" : "positions"} · <b>${money(cost)}</b> in · pays up to <b>${money(pay)}</b>`;
}

function section(cls: string, label: string, day: Date, list: CalEvent[], compact: boolean): string {
  return `<section class="sec ${cls}">
    <div class="sec-head"><h2>${label}</h2><span class="date">${fmt.dayShort.format(day)}</span><span class="sum">${daySummary(list)}</span></div>
    ${list.length ? `<div class="cards${compact ? " compact" : ""}">${numbered(list).map(card).join("")}</div>`
      : `<div class="none">Nothing ${label.toLowerCase()}.</div>`}
  </section>`;
}

function weekStrip(today: Date): string {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const lists = days.map(eventsOn);
  const total = new Set(lists.flat().map((x) => x.item.ticker)).size;
  return `<details class="strip" id="weekstrip"${prefs.weekOpen ? " open" : ""}>
    <summary><h2>Next 7 days</h2><span class="date">${fmt.dayShort.format(days[0])} – ${fmt.dayShort.format(days[6])}</span><span class="sum"><b>${total}</b> position${total === 1 ? "" : "s"}</span></summary>
    <div class="days">${days.map((d, i) => `
      <div class="dd${i === 0 ? " now" : ""}" data-go="${+d}">
        <div><strong>${fmt.wd(d.getDay())}</strong> <span class="n">${d.getDate()}</span></div>
        <div class="n"><b>${lists[i].length}</b>${lists[i].length ? money(lists[i].reduce((a, { item }) => a + costOf(item), 0)) : ""}</div>
      </div>`).join("")}</div>
    <div class="foot-link"><button class="linkbtn" data-view="month">Open month view →</button></div>
  </details>`;
}

interface View {
  title(): string;
  /** The cursor after moving n steps (‹ / ›). */
  step(n: number): Date;
  render(): string;
}

export const views: Record<ViewName, View> = {
  watch: { title: () => "", step: () => state.cursor, render: watchViewHtml },
  pnl: {
    title: () => "",
    step: () => state.cursor,
    render: () => `<div id="pnl" class="pnl"><div class="empty">Loading…</div></div>`,
  },
  home: {
    title: () => "",
    step: () => state.cursor,
    render() {
      if (!state.schedule) return state.needsKey ? "" : `<div class="empty">Loading…</div>`;
      const today = startOfDay(new Date()), tmr = addDays(today, 1);
      return `<div class="home">
        ${section("today", "Today", today, todayEvents(today), false)}
        ${section("tmr", "Tomorrow", tmr, eventsOn(tmr), true)}
        ${weekStrip(today)}
      </div>`;
    },
  },
  day: {
    title: () => fmt.dayLong.format(state.cursor),
    step: (n) => addDays(state.cursor, n),
    render() {
      const list = numbered(eventsOn(state.cursor));
      return list.length ? `<div class="agenda">${list.map(row).join("")}</div>` : `<div class="empty">Nothing on this day.</div>`;
    },
  },
  week: {
    title: () => { const s = startOfWeek(state.cursor); return `${fmt.dayShort.format(s)} – ${fmt.dayShort.format(addDays(s, 6))}`; },
    step: (n) => addDays(state.cursor, 7 * n),
    render() {
      const s = startOfWeek(state.cursor), now = new Date();
      return `<div class="week">${Array.from({ length: 7 }, (_, i) => {
        const d = addDays(s, i), list = numbered(eventsOn(d));
        return `<div class="wcol${sameDay(d, now) ? " now" : ""}"><h3 data-go="${+d}">${fmt.dayShort.format(d)}</h3>${list.map(chip).join("")}</div>`;
      }).join("")}</div>`;
    },
  },
  month: {
    title: () => fmt.month.format(state.cursor),
    step: (n) => new Date(state.cursor.getFullYear(), state.cursor.getMonth() + n, 1),
    render() {
      const c = state.cursor, now = new Date();
      const first = new Date(c.getFullYear(), c.getMonth(), 1);
      const start = startOfWeek(first);
      const weeks = Math.ceil((first.getDay() + new Date(c.getFullYear(), c.getMonth() + 1, 0).getDate()) / 7);
      let cells = "";
      for (let i = 0; i < weeks * 7; i++) {
        const d = addDays(start, i), list = numbered(eventsOn(d));
        const extra = list.length - 4;
        cells += `<div class="cell${d.getMonth() !== c.getMonth() ? " out" : ""}${sameDay(d, now) ? " now" : ""}">
          <span class="d" data-go="${+d}">${d.getDate()}</span>
          ${list.slice(0, extra > 0 ? 3 : 4).map(chip).join("")}
          ${extra > 0 ? `<button class="more" data-go="${+d}">+${extra + 1} more</button>` : ""}</div>`;
      }
      return `<div class="dow">${Array.from({ length: 7 }, (_, i) => `<div>${fmt.wd(i)}</div>`).join("")}</div><div class="month">${cells}</div>`;
    },
  },
  year: {
    title: () => String(state.cursor.getFullYear()),
    step: (n) => new Date(state.cursor.getFullYear() + n, state.cursor.getMonth(), 1),
    render() {
      const y = state.cursor.getFullYear(), now = new Date();
      const head = Array.from({ length: 7 }, (_, i) => `<b style="font-size:10px;color:var(--muted);text-align:center">${fmt.wd(i)[0]}</b>`).join("");
      return `<div class="year">${Array.from({ length: 12 }, (_, m) => {
        const first = new Date(y, m, 1), len = new Date(y, m + 1, 0).getDate();
        let g = head + "<span></span>".repeat(first.getDay());
        for (let d = 1; d <= len; d++) {
          const dt = new Date(y, m, d), n = eventsOn(dt).length;
          g += `<span class="${n ? "has" : ""}${sameDay(dt, now) ? " now" : ""}" style="--n:${Math.min(n, 5)}" data-go="${+dt}" title="${n} event${n === 1 ? "" : "s"}">${d}</span>`;
        }
        return `<div class="mini"><h3 data-month="${+first}">${fmt.monthName.format(first)}</h3><div class="g">${g}</div></div>`;
      }).join("")}</div>`;
    },
  },
  list: {
    title: () => "Upcoming",
    step: () => state.cursor,
    render() {
      const from = startOfDay(new Date()).getTime();
      const days = byDay(buildEvents().filter((e) => e.ts >= from));
      if (!days.size) return `<div class="empty">Nothing upcoming.</div>`;
      return `<div class="agenda">${[...days.values()].map((list) =>
        `<h3>${fmt.dayLong.format(list[0].ts)}</h3>${numbered(list).map(row).join("")}`).join("")}</div>`;
    },
  },
};

/** Centered line above the calendar: counts, money, freshness. */
export function summaryHtml(): string {
  const s = state.schedule;
  if (!s) return "";
  const open = s.items.filter(isOpen);
  const combos = open.filter((i) => i.isCombo).length;
  const cost = open.reduce((a, it) => a + costOf(it), 0);
  const pay = open.reduce((a, it) => a + (it.payout ?? 0), 0);
  const ago = Math.round((Date.now() - s.fetchedAt) / 60e3);
  const fresh = s.staleAt ? `${fmt.time.format(s.staleAt)} (couldn't reach Kalshi)`
    : ago < 1 ? "just now" : ago < 60 ? `${ago} min ago` : when(s.fetchedAt);
  const why = ` title="${esc(s.staleReason ? `Live update failed: ${s.staleReason}` : `via ${s.via ?? "?"}`)}"`;
  return `
    <span class="eyebrow">All open positions</span>
    <span><b>${open.length}</b> position${open.length === 1 ? "" : "s"}</span>
    <span><b>${combos}</b> combo${combos === 1 ? "" : "s"}</span>
    <span><b>${money(cost)}</b> in</span>
    <span>pays up to <b>${money(pay)}</b></span>
    <span class="upd${s.staleAt ? " stale" : ""}"${why}>Updated ${fresh}</span>${s.rateLimited
      ? `<span class="upd stale" title="Kalshi asked Kaashify to slow down (HTTP 429). This is the last data; it retries by itself.">rate limited, retrying</span>` : ""}`;
}
