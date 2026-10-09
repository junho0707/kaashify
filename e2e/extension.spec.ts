// Loads the unpacked extension in Chromium against a mocked kalshi.com and public API (see kalshi-mock.ts).
import { test, expect } from "@playwright/test";
import { generateKeyPairSync } from "node:crypto";
import { type Ext, KEY_ID, PEM, TENNIS, launch, settle as settleOn, storage as storageOf } from "./kalshi-mock.ts";

declare const kaashify: any;

let context: Ext["context"], sw: Ext["sw"], extId: string, positionCalls: Ext["positionCalls"];

test.beforeAll(async () => {
  ({ context, sw, extId, positionCalls } = await launch());
});

test.afterAll(() => context?.close());

const settle = () => settleOn(sw);
const storage = (keys) => storageOf(sw, keys);

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

test("Kalshi's rate limit (429) keeps the last data with a note, then recovers", async () => {
  await settle();
  // Every /markets call is turned away (Retry-After 0 keeps the test fast) for the next refresh's retries.
  await context.route("https://api.elections.kalshi.com/trade-api/v2/markets?**", (route) => route.fulfill({ status: 429, headers: { "retry-after": "0" }, body: "" }), { times: 5 });
  const res = await sw.evaluate(() => kaashify.refresh({}));
  expect(res.ok).toBe(true);
  expect(res.data.rateLimited).toBeGreaterThan(0);
  expect(res.data.items).toHaveLength(2);
  expect((await storage("lastError")).lastError).toBeNull();
  expect((await storage("refreshLog")).refreshLog[0]).toMatchObject({ ok: true, rateLimited: true });
  const cal = await context.newPage();
  await cal.goto(`chrome-extension://${extId}/calendar.html`);
  await expect(cal.locator(".sec.today .card")).toHaveCount(2);
  await expect(cal.locator("#status")).toBeHidden();
  await cal.close();
  await settle();
  const ok = await sw.evaluate(() => kaashify.refresh({}));
  expect(ok.data.rateLimited ?? null).toBeNull();
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
