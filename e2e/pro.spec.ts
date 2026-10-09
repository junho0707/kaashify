// The full build end to end: P&L details and alerts.
import { test, expect } from "@playwright/test";
import { COMBO, type Ext, GAME, KEY_ID, PEM, launch, markets, settle as settleOn, storage as storageOf } from "./kalshi-mock.ts";

declare const kaashify: any;

let context: Ext["context"], sw: Ext["sw"], extId: string, positionCalls: Ext["positionCalls"];

test.beforeAll(async () => {
  ({ context, sw, extId, positionCalls } = await launch());
  await sw.evaluate(([id, pem]) => kaashify.setKey(id, pem), [KEY_ID, PEM]);
});

test.afterAll(() => context?.close());

const settle = () => settleOn(sw);
const storage = (keys) => storageOf(sw, keys);
const openCalendar = async () => {
  const cal = await context.newPage();
  await cal.goto(`chrome-extension://${extId}/calendar.html`);
  return cal;
};

test("P&L details: trade table with readable names, breakdown and CSV export", async () => {
  await settle();
  const cal = await openCalendar();
  await cal.click('[data-view="pnl"]');
  await expect(cal.locator(".disclaimer")).toContainText("Live from Kalshi", { timeout: 20000 });
  await cal.click('[data-pnl-range="all"]');
  await expect(cal.locator("#cats .cat").first()).toContainText("Individual bets");
  await cal.locator(".trades > summary").click();
  await expect(cal.locator("#trades tbody tr")).toHaveCount(2);
  await expect(cal.locator("#trades tbody tr").first().locator(".mk")).toHaveText(/^LAD vs ATL: /);
  const download = cal.waitForEvent("download");
  await cal.click("#pnl-export");
  expect((await download).suggestedFilename()).toMatch(/^kaashify-trades-\d{4}-\d{2}-\d{2}\.csv$/);
  await cal.close();
});

test("alerts poll updates leg results from public prices without fetching positions", async () => {
  await settle();
  positionCalls.length = 0;
  markets[`${GAME}-LAD`] = { ...markets[`${GAME}-LAD`], status: "settled", result: "yes" };
  await sw.evaluate(() => kaashify.pollAlerts());
  expect(positionCalls).toEqual([]);
  const { schedule } = await storage("schedule");
  const combo = schedule.items.find((i) => i.ticker === COMBO);
  expect(combo.legs[0].outcome).toBe("won");
  expect(combo.state).toBe("hit");
  expect(schedule.legsAt).toBeGreaterThan(0);
});

test("alerts alarm stays off without the notifications permission", async () => {
  await sw.evaluate(() => chrome.storage.local.set({ alertSettings: { enabled: true } }));
  await sw.evaluate(() => kaashify.syncAlertAlarm());
  expect(await sw.evaluate(() => chrome.alarms.get("alerts"))).toBeFalsy();
});
