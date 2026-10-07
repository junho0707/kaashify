// Store screenshots (1280×800) of the real extension against a mocked Kalshi API with demo data.
// Usage: npm run screenshots  ->  docs/screenshots/*.png (light) and *-dark.png
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";

const EXT = fileURLToPath(new URL("../dist/chromium", import.meta.url)); // npm run screenshots builds it first
const OUT = fileURLToPath(new URL("../docs/screenshots/", import.meta.url));
mkdirSync(OUT, { recursive: true });

const H = 3600e3, DAY = 24 * H, now = Date.now();
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const pad = (n) => String(n).padStart(2, "0");
// Ticker date part in US Eastern wall-clock time, with or without the HHMM start.
function stamp(ts, withTime = true) {
  const et = new Date(new Date(ts).toLocaleString("en-US", { timeZone: "America/New_York" }));
  return `${String(et.getFullYear()).slice(2)}${MON[et.getMonth()]}${pad(et.getDate())}${withTime ? pad(et.getHours()) + pad(et.getMinutes()) : ""}`;
}
// A time today/tomorrow/... at an ET hour (approximate: local midnight + hours is fine for demo data).
const at = (days, hour, min = 0) => { const d = new Date(now + days * DAY); d.setHours(hour, min, 0, 0); return +d; };

const events = {}, markets = {}, milestones = {};
function game(series, code, ts, title, pick, opts = {}) {
  const ev = `KX${series}-${stamp(ts, !opts.dateOnly)}${code}`;
  const mt = `${ev}-${opts.suffix || pick.slice(0, 3).toUpperCase()}`;
  events[ev] = { title, sub_title: title, series_ticker: `KX${series}`, category: "Sports" };
  const p = opts.prob ?? 0.55;
  markets[mt] = { ticker: mt, event_ticker: ev, status: "active", yes_sub_title: pick, yes_bid_dollars: String(p - 0.01), yes_ask_dollars: String(p + 0.01),
    expected_expiration_time: new Date(ts + 3 * H).toISOString() };
  if (opts.live) milestones[ev] = { start_date: new Date(ts).toISOString(), details: { status: "live" } };
  return mt;
}
const positions = [];
function single(mt, contracts, price) {
  positions.push({ ticker: mt, position_fp: String(contracts), market_exposure_dollars: String(contracts * price), fees_paid_dollars: String(+(contracts * 0.02).toFixed(2)),
    last_updated_ts: new Date(now - 2 * DAY).toISOString() });
}
let comboN = 0;
function combo(legs, contracts, price, ts) {
  const t = `KXMVECROSSCATEGORY-S2026DEMO${++comboN}-${comboN}A`;
  markets[t] = { ticker: t, event_ticker: `KXMVECROSSCATEGORY-S2026DEMO${comboN}`, status: "active", expected_expiration_time: new Date(ts + 3 * H).toISOString(),
    mve_selected_legs: legs.map((l) => ({ market_ticker: l, event_ticker: markets[l].event_ticker, side: "yes" })) };
  positions.push({ ticker: t, position_fp: String(contracts), market_exposure_dollars: String(contracts * price), fees_paid_dollars: "0.30",
    last_updated_ts: new Date(now - DAY).toISOString() });
}

// Open positions: today, tonight, tomorrow and the rest of the week, across sports.
const lol = game("LOLGAME", "T1GEN", now - 1.2 * H, "T1 vs Gen.G", "T1", { live: true, prob: 0.62 });
single(lol, 40, 0.48);
const nba = game("NBAGAME", "BOSLAL", at(0, 19, 30), "Celtics vs Lakers", "Los Angeles L", { prob: 0.44 });
const nfl = game("NFLGAME", "KCBUF", at(0, 20, 15), "Chiefs vs Bills", "Kansas City", { prob: 0.53 });
const nflS = game("NFLSPREAD", "KCBUF", at(0, 20, 15), "Chiefs vs Bills", "Kansas City wins by over 2.5", { suffix: "KC3", prob: 0.46 });
const nflT = game("NFLTOTAL", "KCBUF", at(0, 20, 15), "Chiefs vs Bills", "Over 47.5", { suffix: "48", prob: 0.5 });
combo([nfl, nflS, nflT], 50, 0.12, at(0, 20, 15));
single(nba, 25, 0.41);
const mlb = game("MLBGAME", "NYYHOU", at(1, 13, 5), "Yankees vs Astros", "New York Y", { prob: 0.57 });
const mlbT = game("MLBTOTAL", "NYYHOU", at(1, 13, 5), "Yankees vs Astros", "Over 8.5 runs", { suffix: "9", prob: 0.49 });
combo([mlb, mlbT], 30, 0.27, at(1, 13, 5));
const nhl = game("NHLGAME", "TORMTL", at(1, 19), "Maple Leafs vs Canadiens", "Toronto", { prob: 0.6 });
single(nhl, 20, 0.58);
const atp = game("ATPMATCH", "SINALC", at(1, 9), "Sinner vs Alcaraz", "Jannik Sinner", { dateOnly: true, prob: 0.52 });
single(atp, 30, 0.5);
const epl = game("EPLGAME", "ARSCHE", at(3, 7, 30), "Arsenal vs Chelsea", "Arsenal", { prob: 0.48 });
const ucl = game("UCLGAME", "RMABAY", at(4, 15), "Real Madrid vs Bayern", "Real Madrid", { prob: 0.45 });
combo([epl, ucl], 40, 0.2, at(3, 7, 30));
const ufc = game("UFCFIGHT", "JONASP", at(4, 22), "Jones vs Aspinall", "Tom Aspinall", { prob: 0.55 });
single(ufc, 15, 0.52);
const ncaaf = game("NCAAFGAME", "OSUMICH", at(2, 12), "Ohio State vs Michigan", "Ohio State", { prob: 0.64 });
single(ncaaf, 35, 0.61);

// Closed trades for the P&L tab: ~70 over two months, seeded so screenshots are stable.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const fills = [];
const SERIES = [["NFLGAME", "Chiefs vs Raiders", "Kansas City"], ["NBAGAME", "Knicks vs Heat", "New York"], ["MLBGAME", "Dodgers vs Braves", "Los Angeles D"],
  ["NHLGAME", "Rangers vs Bruins", "New York R"], ["ATPMATCH", "Djokovic vs Zverev", "Novak Djokovic"], ["LOLGAME", "G2 vs Fnatic", "G2"],
  ["EPLGAME", "Liverpool vs City", "Liverpool"], ["GOLD15M", "Gold price", "Above $2,410"], ["NFLSPREAD", "Eagles vs Cowboys", "Philadelphia wins by over 3.5"]];
for (let i = 0; i < 70; i++) {
  const ts = now - (62 - i * 0.85) * DAY;
  const isCombo = rnd() < 0.3;
  const [series, title, pick] = SERIES[Math.floor(rnd() * SERIES.length)];
  const ev = `KX${series}-${stamp(ts)}D${i}`, mt = `${ev}-X`;
  events[ev] = { title, sub_title: title, series_ticker: `KX${series}`, category: series === "GOLD15M" ? "Commodities" : "Sports" };
  const price = isCombo ? 0.1 + rnd() * 0.2 : 0.35 + rnd() * 0.35;
  const won = rnd() < (isCombo ? price + 0.08 : price + 0.06);
  const n = Math.round(10 + rnd() * 40);
  let ticker = mt;
  markets[mt] = { ticker: mt, event_ticker: ev, status: "finalized", result: won ? "yes" : "no", yes_sub_title: pick, settlement_ts: new Date(ts + 4 * H).toISOString() };
  if (isCombo) {
    const legs = [{ market_ticker: mt, side: "yes" }];
    const extra = rnd() < 0.4 ? 2 : 1, sameSport = rnd() < 0.5;
    for (let k = 1; k <= extra; k++) {
      const [s2, t2, p2] = sameSport ? [series, title, k === 1 ? "Over" : "Wins by 3+"] : SERIES[(SERIES.findIndex((x) => x[0] === series) + 2 * k) % SERIES.length];
      const ev2 = `KX${s2}-${stamp(ts)}E${i}${k}`, mt2 = `${ev2}-X`;
      events[ev2] = { title: t2, sub_title: t2, series_ticker: `KX${s2}`, category: "Sports" };
      markets[mt2] = { ticker: mt2, event_ticker: ev2, status: "finalized", result: won ? "yes" : "no", yes_sub_title: p2 };
      legs.push({ market_ticker: mt2, side: "yes" });
    }
    ticker = `KXMVECROSSCATEGORY-S2026H${i}-${i}B`;
    markets[ticker] = { ticker, event_ticker: `KXMVECROSSCATEGORY-S2026H${i}`, status: "finalized", result: won ? "yes" : "no", settlement_ts: new Date(ts + 4 * H).toISOString(),
      mve_selected_legs: legs };
  }
  fills.push({ ticker, outcome_side: "yes", count_fp: String(n), yes_price_dollars: price.toFixed(2), no_price_dollars: (1 - price).toFixed(2),
    fee_cost: (n * 0.015).toFixed(2), created_time: new Date(ts).toISOString() });
}

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const context = await chromium.launchPersistentContext("", {
  channel: "chromium", viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--host-resolver-rules=MAP *kalshi.com 0.0.0.0"],
});
await context.route("https://api.elections.kalshi.com/**", (route) => {
  const u = new URL(route.request().url()), p = u.pathname;
  if (p.endsWith("/portfolio/balance")) return route.fulfill({ json: { balance: 125000 } });
  if (p.endsWith("/portfolio/positions")) return route.fulfill({ json: { market_positions: positions, cursor: "" } });
  if (p.endsWith("/portfolio/fills")) return route.fulfill({ json: { fills, cursor: "" } });
  if (p.endsWith("/markets")) return route.fulfill({ json: { markets: (u.searchParams.get("tickers") || "").split(",").map((t) => markets[t]).filter(Boolean) } });
  if (p.includes("/markets/")) { const m = markets[decodeURIComponent(p.split("/").pop())]; return m ? route.fulfill({ json: { market: m } }) : route.fulfill({ status: 404, body: "" }); }
  if (p.includes("/events/")) { const e = events[decodeURIComponent(p.split("/").pop())]; return e ? route.fulfill({ json: { event: e } }) : route.fulfill({ status: 404, body: "" }); }
  if (p.endsWith("/milestones")) { const m = milestones[u.searchParams.get("related_event_ticker")]; return route.fulfill({ json: { milestones: m ? [m] : [] } }); }
  if (p.endsWith("/candlesticks")) return route.fulfill({ json: { candlesticks: [] } });
  return route.fulfill({ status: 404, body: "" });
});
const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
const extId = new URL(sw.url()).host;
const page = await context.newPage();
const url = `chrome-extension://${extId}/calendar.html`;
const shot = (name) => page.screenshot({ path: `${OUT}${name}.png` });

for (const theme of ["light", "dark"]) {
  const sfx = theme === "dark" ? "-dark" : "";
  await page.goto(url);
  await page.evaluate((t) => localStorage.setItem("prefs", JSON.stringify({ v: 2, view: "home", theme: t, weekOpen: true })), theme);
  if (theme === "light") {
    await sw.evaluate(() => chrome.storage.local.clear());
    await page.reload();
    await page.waitForSelector("#key-form");
    await shot(`connect${sfx}`);
    await sw.evaluate((pem) => kaashify.setKey("a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d", pem), privateKey.export({ type: "pkcs1", format: "pem" }));
  }
  await page.reload();
  await page.waitForSelector(".sec.today .card");
  await page.waitForTimeout(500);
  await shot(`today${sfx}`);
  await page.click(".sec.today .card >> nth=1");
  await page.waitForTimeout(300);
  await shot(`details${sfx}`);
  await page.keyboard.press("Escape");
  await page.click('[data-view="month"]');
  await page.waitForTimeout(300);
  await shot(`month${sfx}`);
  await page.click('[data-view="pnl"]');
  await page.evaluate(() => document.querySelector('[data-pnl-range="all"]')?.click());
  await page.waitForSelector(".disclaimer", { timeout: 30000 });
  await page.waitForTimeout(500);
  await shot(`pnl${sfx}`);
  await page.click('[data-pnl-range="30d"]');
  await page.waitForTimeout(200);
  await shot(`pnl-30d${sfx}`);
  const box = await page.locator("#chart").boundingBox();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.mouse.move(5, 5); // off the chart: no tooltip in the picture
  await page.waitForTimeout(200);
  await shot(`pnl-zoom${sfx}`);
  await page.click('[data-pnl-range="all"]');
  await page.click('[data-view="home"]');
  if (theme === "light") {
    await page.click("#settings");
    await page.waitForTimeout(300);
    await shot("settings");
    await page.keyboard.press("Escape");
  }
}
await context.close();
console.log("screenshots in docs/screenshots/");
