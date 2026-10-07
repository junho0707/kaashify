// Loads the unpacked extension in Chromium against a mocked kalshi.com and public API.
import { test, expect, chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync, verify, constants } from "node:crypto";

const EXT = fileURLToPath(new URL("../dist/chromium", import.meta.url));
const H = 3600e3;
// The test game must fall on today's date in the browser's time zone: 2h ahead, or 2h back late in the day.
const later = new Date(Date.now() + 2 * H);
const soon = later.toDateString() === new Date().toDateString() ? later : new Date(Date.now() - 2 * H);
const pad = (n) => String(n).padStart(2, "0");
// An ET wall-clock ticker time ~2h from now is close enough for "today/tomorrow" checks.
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const et = new Date(soon.toLocaleString("en-US", { timeZone: "America/New_York" }));
const GAME = `KXMLBGAME-${String(et.getFullYear()).slice(2)}${MON[et.getMonth()]}${pad(et.getDate())}${pad(et.getHours())}00LADATL`;
const TENNIS = "KXWTAMATCH-26OCT06GAUMER";
const COMBO = "KXMVECROSSCATEGORY-S2026TEST-ABC";

// The user's own API key: the mock verifies every signed request with the public half.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs1", format: "pem" });
const KEY_ID = "a1b2c3d4-1111-2222-3333-444455556666";
const signedOk = (req) => {
  const h = req.headers(), path = new URL(req.url()).pathname;
  if (h["kalshi-access-key"] !== KEY_ID || !h["kalshi-access-signature"]) return false;
  return verify("sha256", Buffer.from(h["kalshi-access-timestamp"] + req.method() + path),
    { key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, Buffer.from(h["kalshi-access-signature"], "base64"));
};

// GET /portfolio/positions, two pages by cursor.
const positionsPage1 = { cursor: "p2", market_positions: [
  { ticker: COMBO, position_fp: "10.00", market_exposure_dollars: "2.000000", fees_paid_dollars: "0.100000", last_updated_ts: new Date(Date.now() - 24 * H).toISOString() }] };
const positionsPage2 = { cursor: "", market_positions: [
  { ticker: `${TENNIS}-MER`, position_fp: "5.00", market_exposure_dollars: "2.500000", fees_paid_dollars: "0.000000" }] };

const markets = {
  [COMBO]: { ticker: COMBO, event_ticker: "KXMVECROSSCATEGORY-S2026TEST", status: "active", expected_expiration_time: soon.toISOString(), mve_selected_legs: [{ market_ticker: `${GAME}-LAD`, event_ticker: GAME, side: "yes" }] },
  [`${GAME}-LAD`]: { ticker: `${GAME}-LAD`, event_ticker: GAME, status: "active", yes_sub_title: "Los Angeles D", yes_bid_dollars: "0.55", yes_ask_dollars: "0.57" },
  [`${TENNIS}-MER`]: { ticker: `${TENNIS}-MER`, event_ticker: TENNIS, status: "active", yes_sub_title: "Elise Mertens", yes_bid_dollars: "0.40", yes_ask_dollars: "0.42" },
};

const SOME_PAGE = `<!doctype html><title>Some site</title><body>Hello</body>`;

// The background exposes its functions as `kaashify` on the service worker global (see src/background/index.ts).
declare const kaashify: any;

let context, sw, extId, positionCalls;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    // Never reach the real Kalshi: anything the mocks don't catch fails to resolve.
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--host-resolver-rules=MAP *kalshi.com 0.0.0.0"],
  });
  positionCalls = [];
  await context.route("https://kalshi.com/**", (route) => route.fulfill({ contentType: "text/html", body: SOME_PAGE }));
  await context.route("https://api.elections.kalshi.com/**", (route) => {
    const req = route.request(), u = new URL(req.url());
    if (u.pathname.startsWith("/trade-api/v2/portfolio/")) {
      if (!signedOk(req)) return route.fulfill({ status: 401, json: { error: { code: "authentication_error" } } });
      if (u.pathname.endsWith("/balance")) return route.fulfill({ json: { balance: 1000 } });
      if (u.pathname.endsWith("/positions")) {
        positionCalls.push({ cursor: u.searchParams.get("cursor") || "", filter: u.searchParams.get("count_filter") });
        return route.fulfill({ json: u.searchParams.get("cursor") === "p2" ? positionsPage2 : positionsPage1 });
      }
      if (u.pathname.endsWith("/fills")) {
        const fill = (t, n, px, at) => ({ ticker: t, outcome_side: "yes", book_side: "bid", count_fp: String(n), yes_price_dollars: String(px), no_price_dollars: String(1 - px), fee_cost: "0.10", created_time: at });
        return route.fulfill({ json: u.searchParams.get("cursor")
          ? { fills: [fill("KXOLD-B-X", 10, 0.5, "2026-09-01T10:00:00Z")], cursor: "" }
          : { fills: [fill("KXOLD-A-X", 10, 0.4, "2026-09-02T10:00:00Z")], cursor: "next" } });
      }
      return route.fulfill({ status: 404, body: "" });
    }
    if (u.pathname.endsWith("/markets")) {
      const want = (u.searchParams.get("tickers") || "").split(",");
      if (want[0].startsWith("KXOLD")) return route.fulfill({ json: { markets: want.map((t) => ({ ticker: t, status: "finalized", result: t === "KXOLD-A-X" ? "yes" : "no", settlement_ts: "2026-09-03T00:00:00Z" })) } });
      return route.fulfill({ json: { markets: want.map((t) => markets[t]).filter(Boolean) } });
    }
    if (u.pathname.includes("/events/")) {
      const t = decodeURIComponent(u.pathname.split("/").pop());
      return route.fulfill({ json: { event: { title: t === TENNIS ? "Gauff vs Mertens" : "LAD vs ATL", sub_title: "", series_ticker: t.split("-")[0] } } });
    }
    if (u.pathname.endsWith("/milestones")) {
      const live = u.searchParams.get("related_event_ticker") === TENNIS;
      return route.fulfill({ json: { milestones: live ? [{ start_date: new Date(Date.now() - H).toISOString(), details: { status: "live" } }] : [] } });
    }
    if (u.pathname.endsWith("/candlesticks")) return route.fulfill({ status: 429, headers: { "retry-after": "0" }, body: "" });
    return route.fulfill({ status: 404, body: "" });
  });
  sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  extId = new URL(sw.url()).host;
});

test.afterAll(() => context?.close());

// Waits out refreshes started by pages (each calendar page refreshes when it opens), so a test gets its own run.
const settle = () => sw.evaluate(async () => { while (kaashify.running()) await kaashify.running(); });
const storage = (keys) => sw.evaluate((k) => chrome.storage.local.get(k), keys);

test("first install opens the setup page", async () => {
  await expect.poll(() => context.pages().some((p) => p.url().endsWith("/calendar.html"))).toBe(true);
  const setup = context.pages().find((p) => p.url().endsWith("/calendar.html"));
  await expect(setup.locator("#key-form")).toBeVisible();
  await expect(setup.locator("a.btn.primary")).toHaveAttribute("href", "https://kalshi.com/account/profile");
});

test("before a key is connected, the calendar asks for one (and nothing is fetched)", async () => {
  await settle();
  const cal = await context.newPage();
  await cal.goto(`chrome-extension://${extId}/calendar.html`);
  await expect(cal.locator("#key-form")).toBeVisible();
  expect(positionCalls).toEqual([]);
  expect((await storage("lastError")).lastError).toMatchObject({ needsKey: true });
  await cal.close();
});

test("a wrong private key is rejected and not kept", async () => {
  await settle();
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" });
  const res = await sw.evaluate(([id, pem]) => kaashify.setKey(id, pem).catch((e) => ({ ok: false, message: e.message })), [KEY_ID, other]);
  expect(res.message).toMatch(/rejected your API key \(HTTP 401\)/);
  expect(await sw.evaluate(() => kaashify.Auth.load())).toBeNull();
});

test("connecting a key loads every page of positions with signed requests", async () => {
  await settle();
  const cal = await context.newPage();
  await cal.goto(`chrome-extension://${extId}/calendar.html`);
  await cal.fill("#key-form [name=keyId]", KEY_ID);
  await cal.fill("#key-form [name=pem]", PEM);
  await cal.click("#key-form button[type=submit]");
  await expect(cal.locator(".sec.today .card")).toHaveCount(2, { timeout: 30000 });
  await expect(cal.locator("#status")).toBeHidden();
  await cal.locator("#settings").click();
  await expect(cal.locator("#detail")).toContainText("key a1b2c3d4");
  await cal.keyboard.press("Escape");
  const { schedule, refreshLog } = await storage(["schedule", "refreshLog"]);
  expect(schedule.via).toBe("api");
  expect(refreshLog[0]).toMatchObject({ ok: true, via: "api", positions: 2 });
  expect(positionCalls.slice(-2)).toEqual([{ cursor: "", filter: "position" }, { cursor: "p2", filter: "position" }]);
  // The key is stored non-extractable, and not in extension storage.
  expect(JSON.stringify(await sw.evaluate(() => chrome.storage.local.get(null)))).not.toContain("PRIVATE KEY");
  expect(await sw.evaluate(async () => (await kaashify.Auth.load()).key.extractable)).toBe(false);
  const tennis = schedule.items.find((i) => i.ticker.startsWith(TENNIS));
  expect(tennis.legs[0].phase).toBe("live");
  await cal.close();
});

test("calendar page shows the positions and LIVE", async () => {
  const cal = await context.newPage();
  await cal.goto(`chrome-extension://${extId}/calendar.html`);
  await expect(cal.locator(".sec.today .card")).toHaveCount(2);
  await expect(cal.locator(".sec.today .card", { hasText: "Gauff vs Mertens" }).locator(".when")).toHaveText("LIVE");
  await expect(cal.locator("#summary")).toContainText("2 positions");
  await cal.locator(".card", { hasText: "LAD vs ATL" }).click();
  await expect(cal.locator("#drawer")).toBeVisible();
  await expect(cal.locator(".leg strong")).toHaveText("1 Winner: Los Angeles D");
});

test("a network failure falls back to the last positions", async () => {
  await settle();
  await context.route("https://api.elections.kalshi.com/trade-api/v2/portfolio/positions**", (route) => route.abort(), { times: 1 });
  const res = await sw.evaluate(() => kaashify.refresh({}));
  expect(res.ok).toBe(true);
  expect((await storage("refreshLog")).refreshLog[0]).toMatchObject({ ok: true, via: "snapshot" });
  expect((await sw.evaluate(() => kaashify.refresh({}))).data.via).toBe("api");
});

test("toolbar click shows the overlay on a web page", async () => {
  const page = await context.newPage();
  await page.goto("https://kalshi.com/markets");
  await page.bringToFront();
  // A real toolbar click grants activeTab (no host permission for web pages); tests can't click it, so run the
  // same injected function in the page directly.
  const [src, fn] = await sw.evaluate(() => [kaashify.CAL_URL + "?embed=1", kaashify.toggleOverlay.toString()]);
  await page.evaluate(([src, fn]) => (0, eval)(`(${fn})`)(src, null), [src, fn]);
  await expect.poll(() => page.frames().some((f) => f.url().startsWith(`chrome-extension://`)), { timeout: 10000 }).toBe(true);
  const frame = page.frames().find((f) => f.url().startsWith("chrome-extension://"));
  await expect(frame.locator(".sec.today .card")).toHaveCount(2);
  const download = page.waitForEvent("download");
  await frame.locator("#foot-settings").click();
  await frame.locator("#detail .copy-debug").click();
  expect((await download).suggestedFilename()).toBe("kaashify-debug.json");
  await expect(frame.locator("#ver")).toHaveText(/^v\d/);
  await frame.locator("#x").click();
  await expect.poll(() => page.evaluate(() => !!document.getElementById("kaashify-overlay"))).toBe(false);
});

test("on browser pages the calendar opens in one reused tab", async () => {
  const calTabs = () => context.pages().filter((p) => /\/calendar\.html$/.test(p.url())).length;
  const before = calTabs(); // the install tab and the calendar test's tab
  expect(before).toBeGreaterThanOrEqual(1);
  await sw.evaluate(() => kaashify.openTab());
  await sw.evaluate(() => kaashify.openTab());
  await new Promise((r) => setTimeout(r, 500));
  expect(calTabs()).toBe(before);
});

test("P&L tab loads live history from Kalshi's API (all pages of fills)", async () => {
  await settle();
  const cal = await context.newPage();
  await cal.goto(`chrome-extension://${extId}/calendar.html`);
  await cal.click('[data-view="pnl"]');
  await expect(cal.locator(".disclaimer")).toContainText("Live from Kalshi", { timeout: 20000 });
  await expect(cal.locator(".tile").nth(3)).toContainText("2");
  const { pnlLive } = await storage("pnlLive");
  expect(pnlLive.fills.map((f) => f.market_ticker)).toEqual(["KXOLD-A-X", "KXOLD-B-X"]);
  await cal.close();
});

test("Disconnect removes the key; Clear my data empties storage", async () => {
  await settle();
  await sw.evaluate(() => kaashify.removeKey());
  expect(await sw.evaluate(() => kaashify.Auth.load())).toBeNull();
  expect((await storage("lastError")).lastError).toMatchObject({ needsKey: true });

  const cal = await context.newPage();
  await cal.goto(`chrome-extension://${extId}/calendar.html`);
  cal.once("dialog", (d) => d.accept());
  await cal.locator("#settings").click();
  await cal.locator("#clear").click();
  await expect.poll(async () => Object.keys(await sw.evaluate(() => chrome.storage.local.get(null)))).toEqual([]);
  expect(await sw.evaluate(() => chrome.storage.session.get(null))).toEqual({});
});
