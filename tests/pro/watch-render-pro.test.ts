// The Watch tab in the paid build: notifications for watched items (Pro).
import { test } from "node:test";
import assert from "node:assert/strict";
import { render, wait } from "../render-page.ts";
import { setup } from "../watch-fixtures.ts";

test("Pro build: the Watch tab offers notifications, and the alerts panel has watchlist settings", async () => {
  const sent: any[] = [];
  const { doc } = await render([], (w, store) => { setup(sent)(w, store); }, "src/pro/calendar.ts");
  doc.querySelector('[data-view="watch"]').click();
  await wait(20);
  doc.querySelector(".watch #open-alerts").click();
  await wait(20);
  assert.ok(doc.querySelector('#alert-form [name="watchNew"]').checked);
  assert.equal(doc.querySelector('#alert-form [name="watchStart"]').value, "1");
});
