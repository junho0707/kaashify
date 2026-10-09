// The free calendar page (src/calendar) rendered in jsdom against a stored schedule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { H, MIN, at, item, leg, now, render } from "./render-page.ts";

test("Today view: summary, sections, LIVE only for real start times", async () => {
  const { doc, sent, text } = await render([
    item("LIVE", [leg("Dodgers", "LAD vs ATL", now - 10 * MIN)]),
    // Estimated legs are placed at their end time, so keep it inside today whatever the time of day.
    item("APPROX", [leg("Over 22.5", "Gauff vs Mertens", now - 10 * MIN, { exact: false, end: now - MIN })]),
    item("TMR", [leg("Yankees", "TB vs NYY", at(1, 19)), leg("Chiefs", "KC vs LV", at(3, 20))]),
    item("DONE", [leg("Arsenal", "ARS vs CHE", at(1, 10), { outcome: "lost" })]),
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ type: "refresh", interactive: true }]);
  assert.match(text("#summary")[0], /^All open positions 3 positions 1 combo \$6\.00 in pays up to \$30\.00 Updated just now$/);
  const cards = [...doc.querySelectorAll(".sec.today .card")];
  assert.deepEqual(cards.map((c) => c.querySelector(".num").textContent), cards.map((_, i) => String(i + 1)), "numbered [1] [2] …, no color tags");
  assert.ok(!doc.querySelector("[style*='--h']"));
  const byLabel = Object.fromEntries(cards.map((c) => [c.querySelector(".what").textContent, c.querySelector(".when").textContent.trim()]));
  assert.equal(byLabel["LAD vs ATL"], "LIVE");
  assert.notEqual(byLabel["Gauff vs Mertens"], "LIVE", "estimated times must not show LIVE");
  assert.equal(text(".sec.tmr .card .what")[0], "TB vs NYY");
  assert.ok(!text(".card .what").includes("ARS vs CHE"), "busted combos are hidden");
});

test("cards are tagged with the sports (or categories) their legs live in", async () => {
  const { doc } = await render([
    item("C", [leg("Chiefs", "KC vs LV", at(0, 20), { ticker: "KXNFLGAME-26OCT07KCLV-KC" }), leg("Yankees", "TB vs NYY", at(0, 21), { ticker: "KXMLBGAME-26OCT07TBNYY-NYY" })]),
    item("S", [leg("Yes", "Fed cut?", at(0, 22), { ticker: "KXFEDDECISION-26OCT-C25", category: "Economics" })]),
  ]);
  const tagsOf = (c) => [...c.querySelectorAll(".stag")].map((x) => x.textContent);
  const cards = [...doc.querySelectorAll(".sec.today .card")];
  assert.deepEqual(cards.map(tagsOf), [["Football", "Baseball"], ["Economics"]]);
  assert.equal(cards[0].querySelector(".what").textContent, "KC vs LV · TB vs NYY");
});

test("unsettled positions from earlier days carry over as Pending", async () => {
  const { doc } = await render([item("OLD", [leg("Klimovicova", "Buyukakcay vs Klimovicova", at(-2, 15), { exact: false })])]);
  const card = doc.querySelector(".sec.today .card");
  assert.ok(card, "carried into Today");
  assert.equal(card.querySelector(".when").textContent.trim(), "Pending");
});

test("a game that started long ago is not LIVE", async () => {
  const { doc } = await render([item("STUCK", [leg("Dodgers", "LAD vs ATL", now - 30 * H)])]);
  assert.equal(doc.querySelector(".sec.today .card .when").textContent.trim(), "Pending");
});

test("detail drawer shows picks and the bought/now table", async () => {
  const { doc, text } = await render([item("C", [leg("Yankees", "TB vs NYY", at(1, 19)), leg("Chiefs", "KC vs LV", at(1, 20))])]);
  doc.querySelector(".card").click();
  assert.equal(doc.querySelector("#drawer").hidden, false);
  assert.deepEqual(text(".leg strong"), ["1 Yankees", "2 Chiefs"]);
  assert.match(text(".stats")[0], /Chance \(all legs\)20%25%/);
  doc.querySelector("#close").click();
  assert.equal(doc.querySelector("#drawer").hidden, true);
  doc.querySelector(".card").click();
  assert.equal(doc.querySelector("#drawer").hidden, false);
  doc.querySelector(".card").click(); // same event again closes it
  assert.equal(doc.querySelector("#drawer").hidden, true);
});

test("every view renders", async () => {
  const { doc } = await render([item("C", [leg("Yankees", "TB vs NYY", at(1, 19))])]);
  for (const v of ["week", "month", "year", "list"]) {
    doc.querySelector(`[data-view="${v}"]`).click();
    assert.ok(doc.querySelector("#main").children.length, v);
  }
  doc.querySelector('[data-view="month"]').click();
  assert.ok(doc.querySelectorAll(".cell").length >= 28);
  assert.equal(doc.querySelectorAll(".chip").length, 1);
});

test("titles from Kalshi are escaped", async () => {
  const { doc } = await render([item("X", [leg("<img src=x onerror=alert(1)>", "<b>A</b> vs B", at(1, 19))])]);
  assert.equal(doc.querySelector("img[src=x]"), null);
  assert.equal(doc.querySelector(".card b:not(.money b)"), null);
});

test("Save debug info copies and saves the refresh log", async () => {
  let copied = null;
  const { doc } = await render([item("C", [leg("Yankees", "TB vs NYY", at(1, 19))])], (w) => {
    Object.defineProperty(w.navigator, "clipboard", { value: { writeText: async (t) => (copied = t) } });
    w.URL.createObjectURL = () => "blob:x";
  });
  doc.querySelector("#foot-settings").click();
  await new Promise((r) => setTimeout(r, 20));
  doc.querySelector("#detail .copy-debug").click();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(JSON.parse(copied).refreshLog, [{ via: "page" }]);
});

test("LIVE when Kalshi reports the game in play, even with an estimated time", async () => {
  const l = { ...leg("Mertens", "Gauff vs Mertens", now - 10 * MIN, { exact: false, end: now - MIN }), phase: "live" };
  const { doc } = await render([item("TEN", [l])]);
  assert.equal(doc.querySelector(".sec.today .card .when").textContent.trim(), "LIVE");
});

test("P&L view: live from Kalshi, with the CSV only as a fallback", async () => {
  const fill = (t, n, px, fee, at) => ({ market_ticker: t, is_yes: true, count_fp: String(n), price_dollars: String(px), fee_dollars: String(fee), create_date: at, status: "confirmed" });
  const live = { at: Date.now(), value: { lifetime_pnl: 278, unrealized_pnl: 0 },
    fills: [fill("KXNFLGAME-A-KC", 10, 0.6, 0.1, "2026-09-07T10:00:00Z"), fill("KXMVECROSSCATEGORY-S1-A", 20, 0.05, 0.02, "2026-09-09T10:00:00Z")],
    markets: { "KXNFLGAME-A-KC": { status: "finalized", result: "yes", settlement_ts: "2026-09-07T20:00:00Z" },
      "KXMVECROSSCATEGORY-S1-A": { status: "finalized", result: "no", settlement_ts: "2026-09-09T20:00:00Z" } } };
  let liveOk = false;
  const { doc, w } = await render([item("C", [leg("Yankees", "TB vs NYY", at(1, 19))], { fees: 0.1 })], (w) => {
    w.chrome.runtime.sendMessage = async (m) => m.type === "pnl-live"
      ? (liveOk ? { ok: true, live } : { ok: false, error: "Open kalshi.com (logged in) to load your P&L." }) : {};
  });
  doc.querySelector('[data-view="pnl"]').click();
  await new Promise((r) => setTimeout(r, 30));
  assert.match(doc.querySelector("#pnl").textContent, /Open kalshi\.com \(logged in\)[\s\S]*Choose CSV file/);

  liveOk = true;
  doc.querySelector('[data-view="home"]').click();
  doc.querySelector('[data-view="pnl"]').click();
  await new Promise((r) => setTimeout(r, 50));
  const tiles = [...doc.querySelectorAll(".tile")].map((x) => [...x.children].map((c) => c.textContent).join(" "));
  assert.deepEqual([...doc.querySelectorAll(".tile > span")].map((x) => x.textContent), ["Realized P&L", "Before fees", "Win rate", "Trades"]);
  assert.match(tiles[0], /\+\$2\.88/, "sum of closed trades");
  assert.match(tiles[1], /\+\$3\.00 \$0\.12 paid in fees/);
  assert.match(tiles[2], /50% 1 won · 1 lost/);
  assert.match(doc.querySelector(".disclaimer").textContent, /Live from Kalshi/);
  assert.equal(doc.querySelectorAll("#chart .dot").length, 2);
  doc.querySelector("#chart .dot").dispatchEvent(new w.Event("pointermove", { bubbles: true }));
  assert.match(doc.querySelector("#chart .tip").textContent.replace(/\s+/g, " "), /KXNFLGAME-A-KC ?In \$6\.10 ?Out \$10\.00 ?\+\$3\.90/);
});

test("a finished game waiting for settlement is not LIVE", async () => {
  const { doc } = await render([item("DONE", [{ ...leg("Altmaier", "Rune vs Altmaier", now - H), phase: "done" }])]);
  assert.notEqual(doc.querySelector(".sec.today .card .when").textContent.trim(), "LIVE");
});

test("a combo card is LIVE when any of its legs is live, even one listed on another day", async () => {
  // First leg won earlier today (between midnight and now, whatever the time); the ongoing leg's only time is an estimate tomorrow.
  const early = leg("Gauff", "Gauff vs Mertens", (at(0, 0) + now) / 2, { outcome: "won" });
  const ongoing = { ...leg("Over 22.5", "Rune vs Altmaier", at(1, 2), { exact: false }), phase: "live" };
  const { doc } = await render([item("C", [early, ongoing])]);
  const today = doc.querySelector(".sec.today .card");
  assert.equal(today.querySelector(".when").textContent.trim(), "LIVE");
  assert.notEqual(doc.querySelector(".sec.tmr .card .when")?.textContent.trim(), "LIVE", "future cards don't say LIVE");
});

test("without an API key the calendar shows the connect form and sends the key to the background", async () => {
  const msgs = [];
  const { doc, w } = await render([], (w, store) => {
    delete store.schedule;
    store.lastError = { needsKey: true, message: "Connect your Kalshi API key" };
    w.chrome.runtime.sendMessage = async (m) => (msgs.push(m), m.type === "set-key" ? { ok: false, error: { message: "Kalshi rejected your API key (HTTP 401)." } } : {});
  });
  const form = doc.querySelector("#key-form");
  assert.ok(form);
  assert.equal(doc.querySelector("#main").textContent.trim(), "");
  form.querySelector("[name=keyId]").value = "a1b2c3d4-0000-0000-0000-000000000000";
  form.querySelector("[name=pem]").value = "-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----";
  form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 20));
  const sent = msgs.find((m) => m.type === "set-key");
  assert.equal(sent.keyId, "a1b2c3d4-0000-0000-0000-000000000000");
  assert.match(sent.pem, /BEGIN RSA PRIVATE KEY/);
  assert.match(doc.querySelector("#key-msg").textContent, /didn't accept that key/);
});

test("pasting Kalshi's key text (Key ID + private key together) fills both fields and connects", async () => {
  const msgs = [];
  const { doc, w } = await render([], (w, store) => {
    delete store.schedule;
    store.lastError = { needsKey: true };
    w.chrome.runtime.sendMessage = async (m) => (msgs.push(m), m.type === "set-key" ? { ok: true } : {});
  });
  const ta = doc.querySelector("#key-form [name=pem]");
  const ev = new w.Event("paste", { bubbles: true, cancelable: true });
  ev.clipboardData = { getData: () => "Key ID: 0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0\n-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----\n" };
  ta.dispatchEvent(ev);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(doc.querySelector("#key-form [name=keyId]").value, "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0");
  const sent = msgs.find((m) => m.type === "set-key");
  assert.equal(sent.keyId, "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0");
  assert.match(sent.pem, /^-----BEGIN RSA PRIVATE KEY-----[\s\S]+END RSA PRIVATE KEY-----$/);
});

test("settings: account, plan, theme and data actions", async () => {
  const { doc } = await render([item("C", [leg("Yankees", "TB vs NYY", at(1, 19))])], (_w, store) => { store.keyInfo = { keyId: "a1b2c3d4" }; });
  doc.querySelector("#settings").click();
  await new Promise((r) => setTimeout(r, 20));
  const t = doc.querySelector("#detail").textContent.replace(/\s+/g, " ");
  assert.match(t, /Connected ✓ key a1b2c3d4…/);
  assert.ok(doc.querySelector("#unkey") && doc.querySelector("#clear") && doc.querySelector("#theme-pick"));
  doc.querySelector("#rekey").click();
  assert.ok(doc.querySelector("#key-form"));
  assert.equal(doc.querySelector("#drawer").hidden, true);
});

test("P&L time filter: last 24 hours / 7 days / all time, remembered across opens", async () => {
  const iso = (ms) => new Date(ms).toISOString();
  const fill = (t, px, at) => ({ market_ticker: t, is_yes: true, count_fp: "10", price_dollars: String(px), fee_dollars: "0", create_date: iso(at), status: "confirmed" });
  const live = { at: now, fills: [fill("KXNFLGAME-OLD-KC", 0.5, now - 20 * 24 * H), fill("KXNFLGAME-WEEK-KC", 0.5, now - 3 * 24 * H), fill("KXNFLGAME-DAY-KC", 0.5, now - 5 * H)],
    markets: { "KXNFLGAME-OLD-KC": { status: "finalized", result: "yes", settlement_ts: iso(now - 20 * 24 * H + H) },
      "KXNFLGAME-WEEK-KC": { status: "finalized", result: "no", settlement_ts: iso(now - 3 * 24 * H + H) },
      "KXNFLGAME-DAY-KC": { status: "finalized", result: "yes", settlement_ts: iso(now - 2 * H) } } };
  const { doc } = await render([], (w) => {
    w.chrome.runtime.sendMessage = async (m) => (m.type === "pnl-live" ? { ok: true, live } : {});
  });
  doc.querySelector('[data-view="pnl"]').click();
  await new Promise((r) => setTimeout(r, 50));
  const realized = () => doc.querySelector(".tile b").textContent;
  const pick = (k) => doc.querySelector(`[data-pnl-range="${k}"]`).click();
  assert.equal(doc.querySelector(".range-pick .on").dataset.pnlRange, "all");
  assert.equal(realized(), "+$5.00");
  pick("24h");
  assert.equal(realized(), "+$5.00");
  assert.equal(doc.querySelectorAll("#chart .dot").length, 1, "one trade still draws a chart for a window");
  assert.match(doc.querySelector(".tiles").textContent, /last 24 hours/);
  pick("14d");
  assert.equal(realized(), "+$0.00");
  pick("7d");
  assert.equal(realized(), "+$0.00");
  assert.equal(doc.querySelectorAll("#chart .dot").length, 2);
  // An empty window keeps the picker so you can switch back.
  live.fills = [live.fills[0]];
  doc.querySelector('[data-view="home"]').click();
  doc.querySelector('[data-view="pnl"]').click();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(doc.querySelector(".range-pick .on").dataset.pnlRange, "7d", "the choice sticks");
  assert.match(doc.querySelector("#pnl").textContent, /No trades closed in the last 7 days/);
  assert.ok(doc.querySelector('[data-pnl-range="all"]'));
});

test("P&L chart: Y axis labels, drag to zoom, zoom out and reset", async () => {
  const iso = (ms) => new Date(ms).toISOString();
  const days = [40, 30, 20, 10, 5];
  const live = { at: now, fills: days.map((d) => ({ market_ticker: `KXNFLGAME-D${d}-KC`, is_yes: true, count_fp: "10", price_dollars: "0.5", fee_dollars: "0", create_date: iso(now - d * 24 * H), status: "confirmed" })),
    markets: Object.fromEntries(days.map((d, i) => [`KXNFLGAME-D${d}-KC`, { status: "finalized", result: i % 2 ? "no" : "yes", settlement_ts: iso(now - d * 24 * H + H) }])) };
  const { doc, w } = await render([], (w) => {
    w.chrome.runtime.sendMessage = async (m) => (m.type === "pnl-live" ? { ok: true, live } : {});
  });
  doc.querySelector('[data-view="pnl"]').click();
  await new Promise((r) => setTimeout(r, 50));
  doc.querySelector('[data-pnl-range="all"]').click();
  const labels = () => [...doc.querySelectorAll(".y-axis span:not(.sizer)")].map((s) => s.textContent);
  assert.ok(labels().includes("$0"), `has a $0 line: ${labels()}`);
  assert.ok(labels().every((l) => /^−?\$\d/.test(l)) && labels().length >= 3, `labels in dollars: ${labels()}`);
  assert.equal(doc.querySelectorAll("#chart .dot").length, 5);
  assert.ok(doc.querySelector('[data-zoom="reset"]').disabled);

  const drag = (a, b) => {
    const wrap = doc.querySelector("#chart");
    wrap.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 200 });
    const ev = (type, x) => Object.assign(new w.Event(type, { bubbles: true }), { clientX: x, button: 0, pointerId: 1 });
    wrap.dispatchEvent(ev("pointerdown", a));
    wrap.dispatchEvent(ev("pointermove", b));
    wrap.dispatchEvent(ev("pointerup", b));
  };
  const tradesTile = () => +doc.querySelectorAll(".tile b")[3].textContent;
  drag(450, 1000); // the right half: the last two trades or so
  const zoomedDots = doc.querySelectorAll("#chart .dot").length;
  assert.ok(zoomedDots >= 1 && zoomedDots < 5, `zoomed shows fewer trades (${zoomedDots})`);
  const custom = doc.querySelector('.range-pick [data-pnl-range="custom"]');
  assert.ok(custom?.classList.contains("on"), "the filter switches to Custom");
  assert.match(custom.textContent, /^Custom: .+ – .+/);
  assert.equal(doc.querySelectorAll(".range-pick .on").length, 1, "no preset stays selected");
  assert.equal(tradesTile(), zoomedDots, "tiles count only the zoomed range");
  assert.ok(!doc.querySelector('[data-zoom="reset"]').disabled);
  doc.querySelector('[data-zoom="out"]').click();
  assert.ok(doc.querySelectorAll("#chart .dot").length >= zoomedDots);
  doc.querySelector('[data-zoom="reset"]')?.click();
  assert.equal(doc.querySelectorAll("#chart .dot").length, 5);
  assert.equal(tradesTile(), 5);
  assert.ok(!doc.querySelector('[data-pnl-range="custom"]'));
  assert.match(doc.querySelector(".chart-tools").textContent, /Drag across the chart/);
  drag(450, 1000);
  doc.querySelector('[data-pnl-range="all"]').click();
  assert.equal(tradesTile(), 5, "a preset resets the zoom");
  assert.ok(!doc.querySelector('[data-pnl-range="custom"]'));
  drag(500, 505); // a click, not a drag: no zoom
  assert.equal(doc.querySelectorAll("#chart .dot").length, 5);
});

test("P&L chart with thousands of trades: one hover marker instead of a dot per trade", async () => {
  const iso = (ms) => new Date(ms).toISOString();
  const N = 3000, fills = [], markets = {};
  for (let i = 0; i < N; i++) {
    const t = `KXNFLGAME-T${i}-KC`, at = now - (N - i) * H;
    fills.push({ market_ticker: t, is_yes: true, count_fp: "1", price_dollars: "0.5", fee_dollars: "0", create_date: iso(at), status: "confirmed" });
    markets[t] = { status: "finalized", result: i % 3 ? "yes" : "no", settlement_ts: iso(at + 60e3) };
  }
  const live = { at: now, fills, markets };
  const { doc, w } = await render([], (w) => {
    w.chrome.runtime.sendMessage = async (m) => (m.type === "pnl-live" ? { ok: true, live } : {});
  });
  doc.querySelector('[data-view="pnl"]').click();
  await new Promise((r) => setTimeout(r, 100));
  doc.querySelector('[data-pnl-range="all"]').click();
  assert.equal(doc.querySelectorAll(".tile b")[3].textContent, String(N));
  assert.equal(doc.querySelectorAll("#chart .dot").length, 1, "a single marker");
  assert.equal(doc.querySelectorAll("#chart .rug").length, 0);
  const wrap = doc.querySelector("#chart");
  wrap.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 200 });
  wrap.dispatchEvent(Object.assign(new w.Event("pointermove", { bubbles: true }), { clientX: 999 }));
  assert.match(doc.querySelector("#chart .tip").textContent, new RegExp(`KXNFLGAME-T${N - 1}-KC`), "hover finds the last trade");
  assert.equal(doc.querySelector("#chart .dot.marker").hidden, false);
});
