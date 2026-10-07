import { test } from "node:test";
import assert from "node:assert/strict";
import { nearest, niceTicks } from "../src/calendar/chart.ts";

test("gridlines land on round dollar amounts", () => {
  assert.deepEqual(niceTicks(-52, 148), { step: 50, lo: -100, hi: 150 });
  assert.deepEqual(niceTicks(0, 3.2), { step: 1, lo: 0, hi: 4 });
  assert.equal(niceTicks(0, 0.7).step, 0.2);
});

test("hover finds the nearest trade by binary search", () => {
  const pts = [0.1, 0.2, 0.5, 0.9].map((x) => ({ x }));
  assert.equal(nearest(pts, 0), 0);
  assert.equal(nearest(pts, 0.16), 1);
  assert.equal(nearest(pts, 0.34), 1);
  assert.equal(nearest(pts, 0.36), 2);
  assert.equal(nearest(pts, 1), 3);
  // Same answer as a linear scan on a big random set.
  const big = Array.from({ length: 5000 }, () => ({ x: Math.random() })).sort((a, b) => a.x - b.x);
  for (let i = 0; i < 200; i++) {
    const fx = Math.random();
    const linear = big.reduce((best, p, j) => (Math.abs(p.x - fx) < Math.abs(big[best].x - fx) ? j : best), 0);
    assert.equal(Math.abs(big[nearest(big, fx)].x - fx), Math.abs(big[linear].x - fx));
  }
});
