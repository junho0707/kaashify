// The full calendar page (src/pro/calendar.ts) in jsdom: P&L details and alerts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { H, at, item, leg, now, render as renderPage, wait } from "../render-page.ts";

const render = (items: any[], setup: (w: any, store: any) => void = () => {}) => renderPage(items, setup, "src/pro/calendar.ts");
const fill = (t: string, n: number, px: number, fee: number, at: string) =>
  ({ market_ticker: t, is_yes: true, count_fp: String(n), price_dollars: String(px), fee_dollars: String(fee), create_date: at, status: "confirmed" });
const clean = (x: unknown) => JSON.parse(JSON.stringify(x));
const text = (el: any) => el.textContent.replace(/\s+/g, " ");

test("alerts panel saves settings and asks for the notifications permission", async () => {
  let asked = null;
  const { doc, w } = await render([], (w, store) => {
    w.chrome.storage.local.set = async (v) => Object.assign(store, v);
    w.chrome.permissions = { request: async (p) => ((asked = p), true) };
  });
  const store = await w.chrome.storage.local.get();
  doc.querySelector("#alerts").click();
  await wait(20);
  const box = doc.querySelector('#alert-form [name="enabled"]');
  box.checked = true;
  box.dispatchEvent(new w.Event("change", { bubbles: true }));
  await wait(20);
  assert.deepEqual(clean(asked), { permissions: ["notifications"] });
  assert.deepEqual(clean(store.alertSettings), { enabled: true, startMins: 15, settled: true, comboDone: true, oddsMove: 0.15, watchNew: true, watchStart: 1 });
  assert.match(doc.querySelector("#alert-note").textContent, /Alerts are on/);
});

test("P&L details: trade table, breakdown and tooltips with readable names", async () => {
  const live = { at: Date.now(),
    fills: [fill("KXNFLGAME-A-KC", 10, 0.6, 0.1, "2026-09-07T10:00:00Z"), fill("KXMVECROSSCATEGORY-S1-A", 20, 0.05, 0.02, "2026-09-09T10:00:00Z")],
    markets: { "KXNFLGAME-A-KC": { status: "finalized", result: "yes", settlement_ts: "2026-09-07T20:00:00Z" },
      "KXMVECROSSCATEGORY-S1-A": { status: "finalized", result: "no", settlement_ts: "2026-09-09T20:00:00Z" } } };
  const asked: string[][] = [];
  const { doc, w } = await render([], (w) => {
    w.chrome.runtime.sendMessage = async (m) => m.type === "pnl-live" ? { ok: true, live }
      : m.type === "trade-info" ? (asked.push(m.tickers), { ok: true, info: {
        "KXNFLGAME-A-KC": { event: "Chiefs vs Raiders", pick: "Kansas City" },
        "KXMVECROSSCATEGORY-S1-A": { event: "MVE", pick: "x", legs: [{ pick: "Lakers", side: "yes", market_ticker: "KXNBAGAME-X-LAL" }, { pick: "Over 8.5", side: "yes", market_ticker: "KXNBATOTAL-X-9" }] } } })
      : {};
  });
  doc.querySelector('[data-view="pnl"]').click();
  await wait(50);
  doc.querySelector('[data-pnl-range="all"]').click();
  await wait(20);
  const cats = [...doc.querySelectorAll("#cats .cat")];
  const name = (c) => c.querySelector(":scope > summary .name").textContent;
  assert.deepEqual(cats.map(name), ["Combos", "2 legs", "Basketball", "Individual bets", "Football"]);
  assert.match(text(cats[0].querySelector("summary")), /1 trade · 0–1 · avg −100%.*−\$1\.02/);
  assert.match(text(cats[2]), /Worst: Lakers \+ Over 8\.5/);
  assert.match(text(cats[3].querySelector("summary")), /1 trade · 1–0 · avg \+64%.*\+\$3\.90/);
  assert.match(text(cats[4]), /WorkedNFL · winner1–0 · avg \+64%\+\$3\.90/);
  const rows = [...doc.querySelectorAll("#trades tbody tr")].map((r: any) => [...r.cells].map((c: any) => c.textContent.trim()).join(" | "));
  assert.equal(rows.length, 2);
  assert.match(rows[0], /Lakers \+ Over 8\.5Combo · lost \| \$1\.02 \| \$0\.00 \| −\$1\.02 \| −100%$/);
  assert.match(rows[1], /Chiefs vs Raiders: Kansas CitySingle · won \| \$6\.10 \| \$10\.00 \| \+\$3\.90 \| \+64%$/);
  assert.ok(doc.querySelector("#pnl-export"));
  doc.querySelector("#chart .dot").dispatchEvent(new w.Event("pointermove", { bubbles: true }));
  assert.match(text(doc.querySelector("#chart .tip")), /Chiefs vs Raiders ?Kansas City ?In \$6\.10 ?Out \$10\.00 ?\+\$3\.90/);
  assert.equal(asked.length, 1, "names are asked for once, then reused across redraws");
});

test("P&L table, CSV and breakdown follow the selected range, including a zoomed Custom range", async () => {
  const iso = (ms: number) => new Date(ms).toISOString();
  const days = [40, 30, 20, 10, 5];
  const live = { at: now, fills: days.map((d) => fill(`KXNFLGAME-D${d}-KC`, 10, 0.5, 0, iso(now - d * 24 * H))),
    markets: Object.fromEntries(days.map((d, i) => [`KXNFLGAME-D${d}-KC`, { status: "finalized", result: i % 2 ? "no" : "yes", settlement_ts: iso(now - d * 24 * H + H) }])) };
  let csv = "";
  const { doc, w } = await render([], (w) => {
    w.chrome.runtime.sendMessage = async (m) => (m.type === "pnl-live" ? { ok: true, live } : m.type === "trade-info" ? { ok: true, info: {} } : {});
    w.URL.createObjectURL = (b) => { b.text().then((t) => (csv = t)); return "blob:x"; };
  });
  doc.querySelector('[data-view="pnl"]').click();
  await wait(50);
  const tableRows = () => doc.querySelectorAll("#trades tbody tr").length;
  const catCount = () => +text(doc.querySelector("#cats .cat summary .sub")).match(/(\d+) trades?/)[1];
  doc.querySelector('[data-pnl-range="all"]').click();
  assert.equal(tableRows(), 5);
  doc.querySelector('[data-pnl-range="14d"]').click();
  assert.equal(tableRows(), 2);
  assert.equal(catCount(), 2);
  doc.querySelector("#pnl-export").click();
  await wait(20);
  assert.equal(csv.trim().split("\r\n").length, 3, "header + the 2 trades in range");

  doc.querySelector('[data-pnl-range="all"]').click();
  const wrap = doc.querySelector("#chart");
  wrap.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 200 });
  const ev = (type: string, x: number) => Object.assign(new w.Event(type, { bubbles: true }), { clientX: x, button: 0, pointerId: 1 });
  wrap.dispatchEvent(ev("pointerdown", 450));
  wrap.dispatchEvent(ev("pointermove", 1000));
  wrap.dispatchEvent(ev("pointerup", 1000));
  const zoomed = doc.querySelectorAll("#chart .dot").length;
  assert.ok(doc.querySelector('[data-pnl-range="custom"]'));
  assert.ok(zoomed < 5);
  assert.equal(tableRows(), zoomed, "the table shows the zoomed range");
  assert.equal(catCount(), zoomed, "so does the breakdown");
});

test("settings: alerts section, no plan or payment", async () => {
  const { doc } = await render([item("C", [leg("Yankees", "TB vs NYY", at(1, 19))])], (_w, store) => { store.keyInfo = { keyId: "a1b2c3d4" }; });
  doc.querySelector("#settings").click();
  await wait(20);
  const t = text(doc.querySelector("#detail"));
  assert.match(t, /Kalshi account.*Alerts.*Alert settings….*Appearance/);
  assert.doesNotMatch(t, /Plan|\$5|Pro/);
  doc.querySelector("#open-alerts").click();
  await wait(20);
  assert.ok(doc.querySelector("#alert-form"));
});
