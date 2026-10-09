// The P&L tab: one time range shared by the tiles and the chart. A preset (24 hours … all time) or, after
// dragging on the chart, a "Custom" range. Data comes live from Kalshi's API; a CSV import is the fallback.

import * as Pnl from "../lib/pnl.ts";
import type { History, PnlLiveResult, Trade } from "../lib/types.ts";
import { chartHtml, initChart } from "./chart.ts";
import { $maybe, closest, esc } from "./dom.ts";
import { DAY, fmt, money, pct, pnlCls, signed } from "./format.ts";
import { type RangeKey, prefs, savePrefs, state } from "./state.ts";

const RANGES: [RangeKey, string, () => number | null][] = [
  ["24h", "Last 24 hours", () => Date.now() - DAY],
  ["7d", "Last 7 days", () => Date.now() - 7 * DAY],
  ["14d", "Last 14 days", () => Date.now() - 14 * DAY],
  ["30d", "Last 30 days", () => Date.now() - 30 * DAY],
  ["90d", "Last 90 days", () => Date.now() - 90 * DAY],
  ["ytd", "This year", () => new Date(new Date().getFullYear(), 0, 1).getTime()],
  ["all", "All time", () => null],
];
/** Extension points for the paid build: extra sections under the chart, and a callback once they're on the page. */
export const pnlHooks = {
  /** Runs before each render (e.g. to check what's unlocked). */
  prepare: async (): Promise<void> => {},
  /** HTML placed under the chart for the trades in range. */
  sections: (_trades: Trade[]): string => "",
  /** The trades in range are drawn (empty when none are). */
  drawn: (_trades: Trade[]): void => {},
};

const preset = () => RANGES.find(([k]) => k === prefs.pnlRange) ?? RANGES.at(-1)!;

/** The custom range from zooming the chart, or null when a preset applies. */
let zoom: [number, number] | null = null;
/** First trade → now: the widest a zoom-out can go. */
let extent: [number, number] = [0, 0];
/** What's drawn, so a range change redraws without fetching. */
let shown: { el: HTMLElement; trades: Trade[]; source: string } | null = null;
let fetchedAt = 0;

const rangeText = ([a, b]: [number, number]) => { const f = b - a <= 2 * DAY ? fmt.full : fmt.dayShort; return `${f.format(a)} – ${f.format(b)}`; };

function rangePicker(): string {
  const on = (k: string) => (zoom ? k === "custom" : k === preset()[0]);
  return `<div class="range-pick" role="group" aria-label="Time range">${RANGES.map(([k, label]) =>
    `<button data-pnl-range="${k}" class="${on(k) ? "on" : ""}" aria-pressed="${on(k)}">${label.replace(/^Last /, "")}</button>`).join("")}${
    zoom ? `<button data-pnl-range="custom" class="on custom" aria-pressed="true" title="Zoomed range. Pick a preset to go back.">Custom: ${esc(rangeText(zoom))}</button>` : ""}</div>`;
}

function draw(el: HTMLElement, trades: Trade[], source: string): void {
  shown = { el, trades, source };
  if (!trades.length) return void (el.innerHTML = `<div class="empty">No closed trades yet.</div>`);
  const now = Date.now();
  extent = [Math.min(...trades.map((x) => x.closedAt)), now];
  const [, presetLabel, fromOf] = preset();
  const from = zoom ? zoom[0] : fromOf(), to = zoom ? zoom[1] : now;
  const label = zoom ? rangeText(zoom) : presetLabel;
  const lower = zoom ? label : label.toLowerCase();
  const t = Pnl.inRange(trades, from, to + 1);
  if (!t.length) {
    el.innerHTML = `${rangePicker()}<div class="empty">No trades closed ${zoom ? "in this range" : label === "This year" ? "this year" : `in the ${lower}`}.</div>
      <p class="sub disclaimer">${source}</p>`;
    return pnlHooks.drawn([]);
  }
  const s = Pnl.summary(t);
  const last = Math.max(...t.map((x) => x.closedAt));
  el.innerHTML = `
    ${rangePicker()}
    <div class="tiles">
      <div class="tile"><span>Realized P&amp;L</span><b class="${pnlCls(s.pnl)}">${signed(s.pnl)}</b><small>after fees</small></div>
      <div class="tile"><span>Before fees</span><b class="${pnlCls(s.pnl + s.fees)}">${signed(s.pnl + s.fees)}</b><small>${money(s.fees)} paid in fees</small></div>
      <div class="tile"><span>Win rate</span><b>${s.hitRate == null ? "–" : pct(s.hitRate)}</b><small>${s.won} won · ${s.lost} lost${s.exited ? ` · ${s.exited} sold early` : ""}</small></div>
      <div class="tile"><span>Trades</span><b>${s.count}</b><small>${from == null ? `through ${fmt.dayShort.format(last)}` : esc(lower)}</small></div>
    </div>
    <section class="pnl-sec"><h3>P&amp;L over time <span class="sub">hover for each trade${from == null ? "" : esc(` · ${lower}`)}</span></h3>${chartHtml(t, from == null ? null : { from, to }, !!zoom)}</section>
    ${pnlHooks.sections(t)}
    <p class="sub disclaimer">From your own trade history, not trading advice. ${source}</p>`;
  pnlHooks.drawn(t);
}

const redraw = () => shown && draw(shown.el, shown.trades, shown.source);

/** Realized P&L = the sum of closed trades from the fills, the same basis as Kalshi's "Total PnL". */
function fromLive(live: History): { trades: Trade[]; source: string } {
  const trades = Pnl.fromFills(live.fills, new Map(Object.entries(live.markets || {})));
  // Held, unsettled markets aren't realized. Any that aren't among the open positions are listed so a gap is explainable.
  const openNow = new Set((state.schedule?.items || []).map((it) => it.ticker));
  const odd = (trades.notCounted || []).filter((x) => !openNow.has(x.ticker));
  const note = odd.length ? ` Not counted (no result yet): ${odd.map((x) => esc(x.ticker) + (x.known ? ` (${esc(x.status)})` : " (no market data)")).join(", ")}.` : "";
  return { trades, source: `Live from Kalshi, updated ${fmt.time.format(live.at)}.${note}` };
}

/** Draws the last copy right away, then fetches new fills (at most once a minute). Never leaves "Loading…". */
export function renderPnl(): Promise<void> {
  return renderInner().catch((e: Error) => {
    const el = $maybe("#pnl");
    if (!el) return;
    el.innerHTML = /context invalidated/i.test(e?.message) || !chrome.runtime?.id
      ? `<div class="empty">Kaashify was updated. Close this window and click the Kaashify icon again.</div>`
      : `<div class="empty">Couldn't show P&amp;L: ${esc(e?.message || e)} <button class="linkbtn" id="pnl-retry">Try again</button></div>`;
  });
}

async function renderInner(): Promise<void> {
  const el = $maybe("#pnl");
  if (!el) return;
  await pnlHooks.prepare();
  const { pnlLive = null, pnlTrades = null } = await chrome.storage.local.get(["pnlLive", "pnlTrades"]) as
    { pnlLive?: History | null; pnlTrades?: { trades: Trade[]; fileName: string } | null };
  if (pnlLive) { const d = fromLive(pnlLive); draw(el, d.trades, d.source); }
  else if (pnlTrades?.trades?.length) draw(el, pnlTrades.trades, `File ${esc(pnlTrades.fileName)}.`);
  else el.innerHTML = `<div class="empty">Loading your P&amp;L from Kalshi…</div>`;
  if (Date.now() - fetchedAt < 60e3 && pnlLive) return;
  fetchedAt = Date.now();
  const r: PnlLiveResult = await chrome.runtime.sendMessage({ type: "pnl-live" }).catch((e: Error) => ({ ok: false, error: e.message }));
  const now = $maybe("#pnl");
  if (!now) return;
  if (r?.ok) { const d = fromLive(r.live); return draw(now, d.trades, d.source); }
  const error = r && !r.ok ? r.error : undefined;
  if (pnlLive || pnlTrades?.trades?.length) return void $maybe("#pnl .disclaimer")?.insertAdjacentHTML("afterbegin", `<b>Couldn't update: ${esc(error)}</b> `);
  now.innerHTML = `<div class="pnl-empty"><h2>Your realized P&amp;L</h2><p>${esc(error || "Couldn't reach Kalshi.")}</p>
    <p class="sub">Or import Kalshi's Realized P&amp;L CSV (it can lag a day): <label class="import"><input type="file" id="pnl-file" accept=".csv,text/csv" hidden><span class="linkbtn">Choose CSV file</span></label></p>
    <p id="pnl-msg" class="sub"></p></div>`;
}

/** After a new key is connected, the next P&L view fetches right away. */
export const forgetFetch = () => void (fetchedAt = 0);

async function importCsv(file: File): Promise<void> {
  const msg = (t: string) => { const m = $maybe("#pnl-msg"); if (m) m.textContent = t; else alert(t); };
  try {
    const trades = Pnl.parseExport(await file.text());
    if (!trades.length) return msg("No trades found in that file.");
    await chrome.storage.local.set({ pnlTrades: { trades, fileName: file.name, importedAt: Date.now() } });
    renderPnl();
  } catch (e) {
    msg((e as Error).message);
  }
}

/** Range buttons, zoom, retry and CSV import. Called once. */
export function initPnl(): void {
  initChart({
    onZoom: (r) => { zoom = r; redraw(); },
    onReset: () => { if (zoom) { zoom = null; redraw(); } },
    onZoomOut: ([t0, t1]) => {
      // Twice as wide around the middle, kept within the trade history; the whole history = back to the preset.
      const mid = (t0 + t1) / 2, a = Math.max(extent[0], mid - (t1 - t0)), b = Math.min(extent[1], mid + (t1 - t0));
      zoom = b - a >= extent[1] - extent[0] ? null : [a, b];
      redraw();
    },
  });
  document.addEventListener("click", (e) => {
    const r = closest(e.target, "[data-pnl-range]");
    if (r && shown && r.dataset.pnlRange !== "custom") {
      prefs.pnlRange = r.dataset.pnlRange as RangeKey;
      zoom = null;
      savePrefs();
      redraw();
    }
    if ((e.target as Element).id === "pnl-retry") renderPnl();
  });
  document.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    if (input.id === "pnl-file" && input.files?.[0]) importCsv(input.files[0]);
  });
}
