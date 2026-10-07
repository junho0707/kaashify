// Generates extension/icons/{16,32,48,128}.png (plus logo.svg): a fanned pile of dollar bills whose seal holds a K with a
// dollar-sign bar peeking out above and below. Rendered through Playwright's Chromium (already a dev dependency).
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const C = { ink: "#0b3a1f", trim: "#bff0c9", seal: "#e6f8ea" };
const BILLS = [["b1", "#1d6a39", "#175a30"], ["b2", "#2b8a4c", "#237a41"], ["b3", "#45b469", "#33995a"]];

// The K is the Archivo Black glyph (OFL) outlined to a path, cap height 30, centered on the seal at (64, 81).
const K_PATH = "M57.39 78.82L68.08 66L80.02 66L69.25 78.34L80.24 96L68.86 96L62.63 85.01L57.39 89.28L57.39 96L47.76 96L47.76 66L57.39 66L57.39 78.82Z";
function K(color) {
  return `<path d="${K_PATH}" fill="${color}"/>
    <path d="M64 57 V66 M64 96 V105" stroke="${color}" stroke-width="4"/>`;
}

// `small` (16/32 px) drops the face detail and draws a bigger white K so the mark survives at toolbar size.
function svg(small) {
  const bill = (transform, fill, body = "") =>
    `<g transform="${transform}"><rect x="8" y="50" width="112" height="62" rx="8" fill="url(#${fill})" stroke="${C.ink}" stroke-width="${small ? 5 : 3}"/>${body}</g>`;
  const trim = `fill="none" stroke="${C.trim}" stroke-width="2"`;
  const face = small ? "" : `
    <rect x="15" y="57" width="98" height="48" rx="4" ${trim} stroke-opacity=".55"/>
    <circle cx="26" cy="81" r="5" ${trim} stroke-opacity=".7"/><circle cx="102" cy="81" r="5" ${trim} stroke-opacity=".7"/>
    <circle cx="64" cy="81" r="25" fill="${C.seal}" stroke="${C.ink}" stroke-width="2.5"/>
    <circle cx="64" cy="81" r="21" fill="none" stroke="#3aa35c" stroke-opacity=".35" stroke-width="1.5"/>`;
  const k = small
    ? `<g transform="translate(64 81) scale(1.4) translate(-64 -81)">${K("#fff")}</g>`
    : K(C.ink);
  const grads = BILLS.map(([id, top, bottom]) =>
    `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 3 128 128">
  <defs>${grads}</defs>
  ${bill("rotate(-6 64 81) translate(-1 -19)", "b1")}
  ${bill("rotate(-2.5 64 81) translate(-2 -9.5)", "b2")}
  ${bill("", "b3", face + k)}
</svg>
`;
}

const icon = (name) => new URL(`../extension/icons/${name}`, import.meta.url);
writeFileSync(icon("logo.svg"), svg(false));
const browser = await chromium.launch();
const page = await browser.newPage();
for (const s of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: s, height: s });
  await page.setContent(`<style>*{margin:0}</style>${svg(s <= 32).replace("<svg ", `<svg width="${s}" height="${s}" `)}`);
  writeFileSync(icon(`${s}.png`), await page.screenshot({ omitBackground: true }));
}
await browser.close();
console.log("icons written");
