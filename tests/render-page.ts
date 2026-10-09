// Renders calendar.html + a bundled page script in jsdom against a stored schedule. Shared by the render tests.
import { after } from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";

const root = new URL("..", import.meta.url);
const bundles = new Map<string, string>();
/** The page script as the browser gets it: an entry bundled into one file (built once per entry). */
function bundle(entry: string): string {
  if (!bundles.has(entry)) {
    bundles.set(entry, buildSync({ entryPoints: [fileURLToPath(new URL(entry, root))], bundle: true, format: "iife",
      write: false, target: "es2022" }).outputFiles[0].text);
  }
  return bundles.get(entry)!;
}
export const H = 3600e3, MIN = 60e3;

export function leg(title: string, sub: string, ts: number, { outcome = "pending", exact = true, ...extra }: Record<string, any> = {}) {
  return { ticker: title, eventTicker: `KXTEST-${sub.replace(/\W/g, "")}`, side: "yes", series: "KXTEST", title, eventTitle: sub, eventSub: sub,
    prob: outcome === "pending" ? 0.5 : null, start: exact ? ts : null, end: ts + 3 * H, outcome, ...extra };
}
export function item(ticker: string, legs: any[], extra: Record<string, any> = {}) {
  return { ticker, isCombo: legs.length > 1, userSide: "yes", contracts: 10, exposure: 2, avgPrice: 0.2, cost: 2, payout: 10,
    title: "", legs, state: legs.some((l) => l.outcome === "lost") ? "busted" : "alive", settleBy: Math.max(...legs.map((l) => l.end)), status: "active", url: null, ...extra };
}

// Each render's window has timers (the calendar refreshes every minute); close them all at the end.
const windows = [];
after(() => windows.forEach((w) => w.close()));

// jsdom handles are loosely typed: the tests poke at whatever the page drew.
export async function render(items: any[], setup: (w: any, store: any) => void = () => {}, entry = "src/calendar/index.ts"): Promise<{ w: any; doc: any; sent: any[]; text: (sel: string) => string[] }> {
  const html = readFileSync(new URL("extension/calendar.html", root), "utf8").replace(/<script.*<\/script>/, "");
  const dom = new JSDOM(html, { url: "chrome-extension://test/calendar.html", runScripts: "outside-only" });
  const w: any = dom.window;
  windows.push(w);
  const store = { schedule: { fetchedAt: Date.now(), items, staleAt: null, via: "page" }, lastError: null, refreshLog: [{ via: "page" }], debugCaptures: [] };
  const sent = [];
  w.matchMedia = () => ({ matches: false });
  w.chrome = {
    storage: { local: { get: async () => store }, session: { get: async () => ({ debugCaptures: [] }) }, onChanged: { addListener() {} } },
    runtime: { id: "test", sendMessage: async (m) => (sent.push(m), {}), getManifest: () => ({ version: "test" }), onMessage: { addListener() {} } },
  };
  setup(w, store);
  // One eval, like two <script> tags sharing globals.
  w.eval(bundle(entry));
  await new Promise((r) => setTimeout(r, 50));
  return { w, doc: w.document, sent, text: (sel) => [...w.document.querySelectorAll(sel)].map((n) => n.textContent.replace(/\s+/g, " ").trim()) };
}

export const now = Date.now();
const today0 = new Date(); today0.setHours(0, 0, 0, 0);
export const at = (days: number, h: number) => +today0 + days * 24 * H + h * H;
export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
