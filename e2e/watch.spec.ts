// Market Watcher end to end: add a team from autocomplete, see its games and markets from the (mocked) public
// API without an API key, and remove it. The watchlist is kept in storage.sync.
import { test, expect } from "@playwright/test";
import { type Ext, launch, watchCalls } from "./kalshi-mock.ts";

declare const kaashify: any;
let context: Ext["context"], sw: Ext["sw"], extId: string;

test.beforeAll(async () => { ({ context, sw, extId } = await launch()); });
test.afterAll(() => context?.close());

test("watch a team: its next games with Kalshi prices, 'no market yet', then remove it", async () => {
  const cal = await context.newPage();
  await cal.goto(`chrome-extension://${extId}/calendar.html`);
  await cal.click('[data-view="watch"]');
  await expect(cal.locator(".watch .empty")).toContainText("Nothing watched yet");
  await cal.fill("#watch-q", "Avalanche");
  await expect(cal.locator("#watch-sugg li").first()).toContainText("Colorado Avalanche (NHL)");
  await cal.keyboard.press("Enter");
  const item = cal.locator('.witem[data-watch-id="team:NHL:COL"]');
  await expect(item.locator(".wev")).toHaveCount(1, { timeout: 20000 });   // first day only
  await item.locator("[data-wmore]").click();
  await expect(cal.locator("#wmodal .wev")).toHaveCount(2);
  await expect(item.locator(".wev")).toHaveCount(1);
  await cal.keyboard.press("Escape");
  await expect(cal.locator("#wmodal")).toHaveCount(0);
  await expect(item.locator(".wev").first().locator(".wtitle")).toHaveText("Colorado vs Calgary");
  await expect(item.locator(".wev").first()).toHaveAttribute("title", /Calgary 31¢/);

  await expect(item).not.toContainText("Edmonton");
  expect(watchCalls).toEqual(expect.arrayContaining(["KXNHLGAME", "KXNHLSPREAD", "KXNHLTOTAL"]));
  const { watchlist } = await sw.evaluate(() => chrome.storage.sync.get("watchlist")) as { watchlist: { id: string }[] };
  expect(watchlist.map((i) => i.id)).toEqual(["team:NHL:COL"]);
  expect(await sw.evaluate(async () => (await chrome.alarms.get("watch"))?.periodInMinutes)).toBe(15);

  // A forced refresh within the cache window doesn't refetch the same series.
  const before = watchCalls.length;
  await sw.evaluate(() => kaashify.refreshWatch({ force: true }));
  expect(watchCalls.length).toBe(before);

  await item.locator("[data-unwatch]").click();
  await expect(cal.locator(".watch .empty")).toBeVisible();
  await expect.poll(() => sw.evaluate(async () => (await chrome.alarms.get("watch")) ?? null)).toBeNull();
  await cal.close();
});
