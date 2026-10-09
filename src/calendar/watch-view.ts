// The Watch tab (Market Watcher): add teams, players, leagues or Kalshi tickers; see each one's next events and
// their Kalshi markets, soonest first. The background fetches (public market data, no key) into
// storage.local.watchResults; the watchlist itself is in storage.sync.

import { MAX_ITEMS, type SeriesEntry, type WatchEvent, type WatchItem, type WatchRequest, type WatchResults,
  type WatchSeriesResult, suggest } from "../lib/watch.ts";
import { $, $maybe, closest, esc } from "./dom.ts";
import { fmt, sameDay, when } from "./format.ts";
import { prefs } from "./state.ts";

/** Extension point for the paid build: a line under the list (notifications for watched items). */
export const watchHooks = { footer: (): string => "" };

const area = (): chrome.storage.StorageArea => chrome.storage.sync ?? chrome.storage.local;
const send = <T>(msg: WatchRequest): Promise<T | null> => Promise.resolve(chrome.runtime.sendMessage(msg)).catch(() => null) as Promise<T | null>;

let list: WatchItem[] = [];
let results: WatchResults | null = null;
let series: SeriesEntry[] = [];
let seriesAsked = false;
let draft = "";
let shown: WatchItem[] = [];
let sel = -1;
let askedAt = 0;
let note = "";

const KIND: Record<WatchItem["kind"], string> = { league: "League", team: "Team", player: "Player", series: "Series", event: "Event" };

/** The tab's frame; the list is filled by renderWatch(), so a redraw of the list keeps what's being typed. */
export const watchViewHtml = (): string => `<div class="watch"><style>
  .watch #watch-list{column-width:200px;column-gap:14px}
  .watch .witem{margin:0 0 12px;min-width:0;break-inside:avoid;display:inline-block;width:100%;border-top:3px solid var(--wc)}
  .watch .witem h3{margin:4px 0 2px;font-size:13px;color:var(--wc)}
  .wmodal{padding:0;border:1px solid var(--line);border-top:3px solid var(--wc);background:var(--bg);color:var(--text);width:min(360px,92vw);max-height:80vh}
  .wmodal::backdrop{background:rgba(0,0,0,.35)}
  .wmodal .wmodal-h{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid var(--line)}
  .wmodal .wmodal-b{padding:4px 12px 12px;overflow:auto;max-height:calc(80vh - 44px)}
  .watch .wday{margin:8px 0 2px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
  .watch a.wev{display:flex;gap:6px;align-items:baseline;padding:2px 0;font-size:13px;color:inherit;text-decoration:none;white-space:nowrap;overflow:hidden}
  .watch a.wev:hover .wtitle{text-decoration:underline}
  .watch a.wev .wtime{flex:0 0 auto;min-width:58px;color:var(--muted);font-variant-numeric:tabular-nums}
  .watch a.wev .wtitle{overflow:hidden;text-overflow:ellipsis}
  .watch a.wev.wdim{opacity:.55}
  .watch .wmore{margin-top:4px;font-size:12px}
  .watch .wlive{flex:0 0 auto;font-size:10px;font-weight:700;padding:0 4px;border-radius:3px;background:#e03131;color:#fff;letter-spacing:.03em}</style>
  <form id="watch-add" class="wadd" autocomplete="off" role="search">
    <div class="wfield"><input id="watch-q" type="text" value="${esc(draft)}" placeholder="Add a team, player, league or Kalshi ticker (e.g. Avalanche, Jack Eichel, NHL)"
      aria-label="Add to watchlist" aria-autocomplete="list" aria-controls="watch-sugg" spellcheck="false">
    <ul id="watch-sugg" class="wsugg" role="listbox" hidden></ul></div>
    <button type="submit" class="primary">Watch</button>
  </form>
  <div class="wbar"><span id="watch-upd" class="sub"></span><span id="watch-note" class="sub"></span><button id="watch-refresh" type="button" title="Refresh now">↻ Refresh</button></div>
  <div id="watch-list"></div>
  ${watchHooks.footer()}
  <p class="sub wfoot">Kalshi markets only, from Kalshi's public market data (no API key needed). Games Kalshi hasn't listed yet don't show up.</p>
</div>`;

const cents = (p: number | null): string => (p == null ? "–" : `${Math.round(p * 100)}¢`);
function timeText(e: WatchEvent): string {
  if (e.start == null) return "Date TBD";
  return e.approx ? `~${fmt.time.format(e.start)}` : fmt.time.format(e.start);
}
const isLive = (e: WatchEvent, now: number): boolean => !e.approx && e.start != null && e.start <= now;
/** "Today" / "Tomorrow" / "Sat, Oct 18" heading for an event's day. */
function dayText(e: WatchEvent, now: number): string {
  if (e.start == null) return "Date TBD";
  return sameDay(e.start, now) ? "Today" : sameDay(e.start, now + 864e5) ? "Tomorrow" : fmt.dayShort.format(e.start);
}


/** One line per event: time, LIVE, teams (links to Kalshi). Dimmed when Kalshi hasn't opened a market yet. */
function eventHtml(e: WatchEvent, now = Date.now()): string {
  const none = !e.markets.length;
  return `<a class="wev${none ? " wdim" : ""}" href="${esc(e.url)}" target="_blank" rel="noopener" title="${esc(none ? "No Kalshi market yet" : e.markets.map((m) => `${m.label} ${cents(m.yesAsk)}`).join(" · "))}">`
    + `<span class="wtime">${esc(timeText(e))}</span>${isLive(e, now) ? `<span class="wlive">LIVE</span>` : ""}<span class="wtitle">${esc(e.title)}</span></a>`;
}

/** Events under day headings (Today / Tomorrow / date). */
/** Event lines under day headings (Today / Tomorrow / date). */
function dayList(evs: WatchEvent[], now = Date.now()): string {
  let day = "", out = "";
  for (const e of evs) {
    const d = dayText(e, now);
    if (d !== day) { out += `<h4 class="wday">${esc(d)}</h4>`; day = d; }
    out += eventHtml(e, now);
  }
  return out;
}

/**
 * A column shows only its first day (today with live games, or the next day that has games), so many columns fit
 * in a small window; "+N more" opens the full schedule in a small popup.
 */
function eventsHtml(id: string, evs: WatchEvent[]): string {
  const now = Date.now();
  const first = dayText(evs[0], now);
  const show = evs.filter((e) => dayText(e, now) === first).length;
  const rest = evs.length - show;
  return dayList(evs.slice(0, show), now)
    + (rest > 0 ? `<button type="button" class="linkbtn wmore" data-wmore="${esc(id)}">+${rest} more (${esc(dayText(evs[show], now))}…)</button>` : "");
}

/** The full schedule of one watched item in a popup (Esc, × or a click outside closes it). */
function openSchedule(id: string): void {
  const item = list.find((i) => i.id === id);
  const r = results?.items[id];
  if (!item || !r) return;
  $maybe("#wmodal")?.remove();
  const d = document.createElement("dialog");
  d.id = "wmodal";
  d.className = "watch wmodal";
  d.setAttribute("style", `--wc:${sportColor(item)}`);
  d.innerHTML = `<div class="wmodal-h"><b>${esc(item.label)}</b><button type="button" class="linkbtn" data-wclose aria-label="Close">×</button></div>
    <div class="wmodal-b">${dayList(r.events)}</div>`;
  d.addEventListener("click", (e) => { if (e.target === d || closest(e.target, "[data-wclose]")) { try { d.close(); } catch { /* jsdom */ } d.remove(); } });
  d.addEventListener("close", () => d.remove());
  document.body.append(d);
  if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
}

/** A colour per sport for the column tags (series/event items: from the ticker). */
const SPORT_COLOR: [RegExp, string][] = [
  [/^(NFL)$|^KXNFL/, "#1c7ed6"], [/^(NCAAF)$|^KXNCAAF/, "#7048e8"], [/^(NBA)$|^KXNBA/, "#f76707"],
  [/^(WNBA)$|^KXWNBA/, "#e67700"], [/^(NCAAMB)$|^KXNCAAMB/, "#ae3ec9"], [/^(MLB)$|^KXMLB/, "#364fc7"],
  [/^(NHL)$|^KXNHL/, "#0c8599"], [/^(ATP)$|^KXATP/, "#2f9e44"], [/^(WTA)$|^KXWTA/, "#74b816"],
  [/^(UFC)$|^KXUFC/, "#495057"], [/^(EPL|UCL|LALIGA|MLS)$|^KX(EPL|UCL|LALIGA|MLS|BUNDESLIGA|SERIEA|LIGUE1|LIGAMX)/, "#099268"],
];
function sportColor(i: WatchItem): string {
  const key = "league" in i ? i.league : i.ticker.toUpperCase();
  return SPORT_COLOR.find(([re]) => re.test(key))?.[1] ?? "#868e96";
}

function itemHtml(i: WatchItem): string {
  const r = results?.items[i.id];
  const body = !r ? `<p class="sub">Loading…</p>`
    : r.error && !r.events.length ? `<p class="sub err">Couldn't reach Kalshi (${esc(r.error)}). Retrying on the next refresh.</p>`
    : !r.events.length ? `<p class="sub">No upcoming events on Kalshi.</p>`
    : eventsHtml(i.id, r.events);
  return `<section class="witem" data-watch-id="${esc(i.id)}" style="--wc:${sportColor(i)}">
    <h3 title="${esc(KIND[i.kind])}">${esc(i.label)}
      <button class="linkbtn wx" data-unwatch="${esc(i.id)}" title="Stop watching" aria-label="Stop watching ${esc(i.label)}">×</button></h3>
    ${body}</section>`;
}

/** Fills the list (after the tab's frame is on the page, and whenever the watchlist or results change). */
export function renderWatch(): void {
  const el = $maybe("#watch-list");
  if (!el) return;
  el.innerHTML = list.length ? list.map(itemHtml).join("")
    : `<div class="empty">Nothing watched yet. Add a team (“Avalanche”), a player (“Jack Eichel”), a league (“NHL”) or a Kalshi series or event ticker.</div>`;
  const upd = $maybe("#watch-upd");
  if (upd) upd.textContent = results && list.length ? `Updated ${when(results.at)}` : "";
  const n = $maybe("#watch-note");
  if (n) n.textContent = note;
  // Results are missing or a few minutes old: ask the background (it reuses anything fresher than 2 minutes).
  const stale = !results || Date.now() - results.at > 2 * 60e3 || list.some((i) => !results!.items[i.id]);
  if (list.length && stale && Date.now() - askedAt > 30e3) {
    askedAt = Date.now();
    void send({ type: "watch-refresh" });
  }
}

function drawSuggestions(): void {
  const ul = $maybe<HTMLUListElement>("#watch-sugg");
  if (!ul) return;
  shown = suggest(draft, series);
  sel = Math.min(sel, shown.length - 1);
  ul.hidden = !shown.length;
  ul.innerHTML = shown.map((s, i) => `<li role="option" data-sugg="${i}" class="${i === sel ? "on" : ""}" aria-selected="${i === sel}">
    <span class="tag">${KIND[s.kind]}</span> ${esc(s.label)}${list.some((x) => x.id === s.id) ? ` <span class="sub">(watching)</span>` : ""}</li>`).join("");
}

async function add(item: WatchItem | undefined): Promise<void> {
  if (!item) return;
  note = "";
  if (list.some((x) => x.id === item.id)) note = "Already watching that.";
  else if (list.length >= MAX_ITEMS) note = `You can watch up to ${MAX_ITEMS} things. Remove one first.`;
  else {
    list = [...list, item];
    await area().set({ watchlist: list });
  }
  draft = "";
  sel = -1;
  const q = $maybe<HTMLInputElement>("#watch-q");
  if (q) q.value = "";
  drawSuggestions();
  renderWatch();
}

async function remove(id: string): Promise<void> {
  list = list.filter((x) => x.id !== id);
  await area().set({ watchlist: list });
  renderWatch();
}

async function loadSeries(): Promise<void> {
  if (seriesAsked) return;
  seriesAsked = true;
  const r = await send<WatchSeriesResult>({ type: "watch-series" });
  if (r?.ok) { series = r.list; drawSuggestions(); } else seriesAsked = false; // try again on the next focus
}

export async function initWatch(): Promise<void> {
  const s = await area().get("watchlist") as { watchlist?: WatchItem[] };
  list = Array.isArray(s.watchlist) ? s.watchlist : [];
  const l = await chrome.storage.local.get("watchResults") as { watchResults?: WatchResults | null };
  results = l.watchResults ?? null;
  chrome.storage.onChanged.addListener((c, a) => {
    let changed = false;
    if (c.watchlist && (a === "sync" || (a === "local" && !chrome.storage.sync))) {
      list = Array.isArray(c.watchlist.newValue) ? c.watchlist.newValue as WatchItem[] : [];
      changed = true;
    }
    if (a === "local" && c.watchResults) {
      results = (c.watchResults.newValue as WatchResults | undefined) ?? null;
      changed = true;
    }
    if (changed && prefs.view === "watch") renderWatch();
  });

  document.addEventListener("input", (e) => {
    if ((e.target as Element).id !== "watch-q") return;
    draft = (e.target as HTMLInputElement).value;
    sel = -1;
    drawSuggestions();
  });
  document.addEventListener("focusin", (e) => { if ((e.target as Element).id === "watch-q") void loadSeries(); });
  document.addEventListener("keydown", (e) => {
    if ((e.target as Element).id !== "watch-q" || !shown.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length;
      drawSuggestions();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      shown = [];
      $("#watch-sugg").hidden = true;
    }
  }, true);
  document.addEventListener("submit", (e) => {
    if ((e.target as Element).id !== "watch-add") return;
    e.preventDefault();
    if (!shown.length) shown = suggest(draft, series);
    void add(shown[Math.max(0, sel)]);
  });
  document.addEventListener("click", (e) => {
    const s = closest(e.target, "[data-sugg]");
    if (s) return void add(shown[+s.dataset.sugg!]);
    const x = closest(e.target, "[data-unwatch]");
    if (x) return void remove(x.dataset.unwatch!);
    const more = closest(e.target, "[data-wmore]");
    if (more) return void openSchedule(more.dataset.wmore!);
    if ((e.target as Element).id === "watch-refresh") {
      askedAt = Date.now();
      const b = e.target as HTMLButtonElement;
      b.disabled = true;
      void send({ type: "watch-refresh", force: true }).finally(() => { b.disabled = false; });
    }
    if (!closest(e.target, "#watch-add")) { const ul = $maybe("#watch-sugg"); if (ul) ul.hidden = true; }
  });
}

/** For tests. */
export const watchState = () => ({ list, results });
