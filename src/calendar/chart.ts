// The P&L chart: running total over time with a dollar Y axis, one dot per trade, hover for the nearest trade,
// and drag-to-zoom. The chart only draws; what a zoom means (a "Custom" range) is decided by the P&L view.
//
// Large histories: per-trade dots and tick marks stop at MAX_MARKS trades (thousands of absolutely positioned
// elements make hovering sluggish); past that the line alone is drawn and a single marker follows the cursor.

import * as Pnl from "../lib/pnl.ts";
import type { Trade } from "../lib/types.ts";
import { $maybe, closest, esc } from "./dom.ts";
import { DAY, fmt, money, pnlCls, signed, when } from "./format.ts";

const W = 640, H = 200, PX = 8, PY = 12;
export const MAX_MARKS = 400;

interface Point { t: number; total: number; trade: Trade; x: number; y: number }

/** How a trade is shown in the tooltip, as lines; the paid build swaps in event + picks. */
let nameOf = (t: Trade): string[] => [t.ticker];
export const setTradeNamer = (fn: (t: Trade) => string[]) => void (nameOf = fn);

/** The drawn chart: its time window and points (sorted by time), for hover and zoom. */
let view: { t0: number; t1: number; points: Point[] } | null = null;

/** Round gridline values: steps of 1, 2, 2.5 or 5 × a power of ten. */
export function niceTicks(lo: number, hi: number, n = 4): { step: number; lo: number; hi: number } {
  const raw = (hi - lo || 1) / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw)!;
  return { step, lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step };
}

const axisMoney = (v: number, step: number) =>
  `${v < -1e-9 ? "−" : ""}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: step < 1 ? 2 : 0, maximumFractionDigits: step < 1 ? 2 : 0 })}`;

/**
 * Chart HTML. span = { from, to }: a fixed window (the line starts at $0 at `from` and runs flat to `to`);
 * without it the chart spans the first to the last trade. `zoomed` only changes the hint and buttons.
 */
export function chartHtml(trades: Trade[], span: { from: number; to: number } | null, zoomed: boolean): string {
  const all = Pnl.cumulative(trades);
  if (all.length < (span ? 1 : 2)) { view = null; return ""; }
  const line = span ? [{ t: span.from, total: 0 }, ...all, { t: span.to, total: all.at(-1)!.total }] : all;
  const t0 = line[0].t, t1 = line.at(-1)!.t;
  let lo = 0, hi = 0;
  for (const p of line) { if (p.total < lo) lo = p.total; if (p.total > hi) hi = p.total; }
  const nt = niceTicks(lo, hi);
  lo = nt.lo; hi = nt.hi > nt.lo ? nt.hi : nt.lo + nt.step;
  const yTicks = Array.from({ length: Math.round((hi - lo) / nt.step) + 1 }, (_, i) => lo + i * nt.step);
  const x = (t: number) => PX + ((t - t0) / (t1 - t0 || 1)) * (W - 2 * PX), y = (v: number) => PY + ((hi - v) / (hi - lo || 1)) * (H - 2 * PY);
  const xTicks = Array.from({ length: 5 }, (_, i) => t0 + ((t1 - t0) * i) / 4);
  const tickFmt = t1 - t0 <= 2 * DAY ? fmt.time : fmt.dayShort;
  const points = all.map((p) => ({ ...p, x: x(p.t) / W, y: y(p.total) / H }));
  view = { t0, t1, points };
  const marks = points.length <= MAX_MARKS;
  const yLabels = yTicks.map((v) => axisMoney(v, nt.step));
  const widest = yLabels.reduce((a, b) => (b.length > a.length ? b : a), "");
  const pos = (p: Point) => `left:${p.x * 100}%;top:${p.y * 100}%`;
  return `<div id="chart-host">
  <div class="chart-tools">
    <span class="sub">${zoomed ? "Drag again to zoom further" : "Drag across the chart to zoom in"}</span>
    <button class="linkbtn" data-zoom="out"${zoomed ? "" : " disabled"}>Zoom out</button>
    <button class="linkbtn" data-zoom="reset"${zoomed ? "" : " disabled"}>Reset</button>
  </div>
  <div class="chart-grid">
    <div class="y-axis" aria-hidden="true"><span class="sizer">${widest}</span>
      ${yTicks.map((v, i) => `<span style="top:${(y(v) / H) * 100}%">${yLabels[i]}</span>`).join("")}</div>
    <div class="chart-wrap" id="chart">
      <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="P&L over time, ending at ${signed(all.at(-1)!.total)}">
        ${yTicks.map((v) => `<line x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="${Math.abs(v) < 1e-9 ? "zero" : "grid"}" vector-effect="non-scaling-stroke"/>`).join("")}
        <polyline points="${line.map((p) => `${x(p.t).toFixed(1)},${y(p.total).toFixed(1)}`).join(" ")}" vector-effect="non-scaling-stroke"/>
        ${marks ? points.map((p) => `<line class="rug ${pnlCls(p.trade.pnl)}" x1="${x(p.t)}" x2="${x(p.t)}" y1="${H - 6}" y2="${H}" vector-effect="non-scaling-stroke"/>`).join("") : ""}
      </svg>
      ${marks ? points.map((p, i) => `<i class="dot ${pnlCls(p.trade.pnl)}" data-pt="${i}" style="${pos(p)}"></i>`).join("") : `<i class="dot marker" hidden></i>`}
      <div class="sel" hidden></div>
      <div class="tip" hidden></div>
    </div>
    <span></span>
    <div class="chart-axis">${xTicks.map((t) => `<span>${tickFmt.format(t)}</span>`).join("")}</div>
  </div></div>`;
}

/** Index of the point nearest to fraction fx of the chart's width (points are sorted, so binary search). */
export function nearest(points: { x: number }[], fx: number): number {
  let lo = 0, hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x < fx) lo = mid + 1; else hi = mid;
  }
  return lo > 0 && Math.abs(points[lo - 1].x - fx) <= Math.abs(points[lo].x - fx) ? lo - 1 : lo;
}

function showTip(i: number): void {
  const tip = $maybe("#chart .tip"), p = view?.points[i];
  if (!tip || !p) return;
  const t = p.trade, io = Pnl.inOut(t);
  tip.innerHTML = `<div class="sub">${when(t.closedAt)} · ${t.result === "exited" ? "sold early" : t.result}</div>
    ${nameOf(t).map((l, j) => (j ? `<div class="pick">${esc(l)}</div>` : `<b>${esc(l)}</b>`)).join("")}
    <div class="io"><span>In ${money(io.in)}</span><span>Out ${money(io.out)}</span><span class="${pnlCls(t.pnl)}">${signed(t.pnl)}</span></div>`;
  tip.style.left = `${Math.min(Math.max(p.x * 100, 15), 85)}%`;
  tip.style.top = `${p.y * 100}%`;
  tip.classList.toggle("below", p.y < 0.4);
  tip.hidden = false;
  $maybe("#chart .dot.on")?.classList.remove("on");
  const dot = $maybe(`#chart .dot[data-pt="${i}"]`) ?? $maybe("#chart .dot.marker");
  if (dot?.classList.contains("marker")) { dot.hidden = false; dot.setAttribute("style", `left:${p.x * 100}%;top:${p.y * 100}%`); }
  dot?.classList.add("on");
}

const frac = (e: PointerEvent, wrap: Element) => { const r = wrap.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
/** Chart time at fraction f of its width. */
const timeAt = (f: number) => { const { t0, t1 } = view!; return t0 + Math.min(1, Math.max(0, (f * W - PX) / (W - 2 * PX))) * (t1 - t0); };

export interface ChartEvents {
  /** A drag selected [from, to]. */
  onZoom(range: [number, number]): void;
  /** Zoom out was clicked: the window to widen. */
  onZoomOut(current: [number, number]): void;
  /** Reset or double-click. */
  onReset(): void;
}

/** Wires hover, drag-to-zoom and the zoom buttons once, by delegation (the chart is redrawn often). */
export function initChart(on: ChartEvents): void {
  let drag: { wrap: HTMLElement; from: number; to?: number } | null = null;
  let frame = 0, lastMove: PointerEvent | null = null;

  document.addEventListener("pointerdown", (e) => {
    const wrap = closest(e.target, "#chart");
    if (!wrap || e.button !== 0 || !view) return;
    e.preventDefault();
    drag = { wrap, from: frac(e, wrap) };
    wrap.setPointerCapture?.(e.pointerId);
  });

  // Hover work runs at most once per animation frame, however fast the pointer events come.
  const hover = () => {
    frame = 0;
    const e = lastMove!;
    if (drag) {
      const f = drag.to ?? drag.from, sel = drag.wrap.querySelector<HTMLElement>(".sel")!;
      Object.assign(sel.style, { left: `${Math.min(f, drag.from) * 100}%`, width: `${Math.abs(f - drag.from) * 100}%` });
      sel.hidden = false;
      drag.wrap.querySelector<HTMLElement>(".tip")!.hidden = true;
      return;
    }
    const wrap = closest(e.target, "#chart");
    if (!wrap || !view?.points.length) return void $maybe("#chart .tip")?.setAttribute("hidden", "");
    showTip(nearest(view.points, frac(e, wrap)));
  };
  document.addEventListener("pointermove", (e) => {
    lastMove = e;
    if (drag) drag.to = frac(e, drag.wrap); // right away: the drag may end before the next frame
    if (typeof requestAnimationFrame !== "function") return hover();
    frame ||= requestAnimationFrame(hover);
  });

  document.addEventListener("pointerup", () => {
    if (!drag) return;
    const { from, to } = drag;
    drag = null;
    const hideSel = () => { const s = $maybe("#chart .sel"); if (s) s.hidden = true; };
    if (to == null || Math.abs(to - from) < 0.02) return hideSel(); // a click, not a drag
    const a = timeAt(Math.min(from, to)), b = timeAt(Math.max(from, to));
    if (b - a < 10 * 60e3) return hideSel();
    on.onZoom([a, b]);
  });

  document.addEventListener("dblclick", (e) => { if (closest(e.target, "#chart")) on.onReset(); });
  document.addEventListener("click", (e) => {
    const z = closest(e.target, "[data-zoom]");
    if (!z || !view) return;
    if (z.dataset.zoom === "reset") on.onReset();
    else on.onZoomOut([view.t0, view.t1]);
  });
}
