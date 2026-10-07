import { test } from "node:test";
import assert from "node:assert/strict";
import { Cache } from "../src/lib/cache.ts";

const DAY = 864e5;

test("round-trips through storage and only reports changes", () => {
  const a = new Cache(undefined, 0);
  assert.equal(a.dirty, false);
  a.set("ev:X", { title: "LAD vs ATL" });
  assert.equal(a.dirty, true);
  const b = new Cache(JSON.parse(JSON.stringify(a)), 0);
  assert.deepEqual(b.get("ev:X"), { title: "LAD vs ATL" });
  assert.equal(b.dirty, false, "reading on the same day changes nothing");
  assert.equal(new Cache(a.toJSON(), 3 * DAY).get("ev:X") !== undefined, true);
});

test("a cache from an older version is replaced", () => {
  const c = new Cache({ "KXMLB-X": { title: "old shape" } }, 0);
  assert.equal(c.size, 0);
  assert.equal(c.dirty, true, "so the old object gets overwritten");
});

test("entries unused for too long are dropped; the newest are kept past the cap", () => {
  const c = new Cache(undefined, 0);
  c.set("old", 1);
  const later = new Cache(c.toJSON(), 60 * DAY);
  later.set("new", 2);
  later.prune(45);
  assert.equal(later.has("old"), false);
  assert.equal(later.get("new"), 2);

  const many = new Cache(undefined, 0);
  for (let i = 0; i < 10; i++) many.set(`k${i}`, i);
  const next = new Cache(many.toJSON(), 5 * DAY);
  next.get("k3"); // used today: survives
  next.prune(45, 4);
  assert.equal(next.size, 4);
  assert.ok(next.has("k3"));
});
