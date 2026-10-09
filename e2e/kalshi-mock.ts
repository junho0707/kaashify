// A mocked Kalshi (website + API) for the end-to-end tests: the API verifies every signed request against the
// test key, and serves two pages of positions, two pages of fills, and public market data.
import { chromium, type BrowserContext, type Worker } from "@playwright/test";
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
export const GAME = `KXMLBGAME-${String(et.getFullYear()).slice(2)}${MON[et.getMonth()]}${pad(et.getDate())}${pad(et.getHours())}00LADATL`;
export const TENNIS = "KXWTAMATCH-26OCT06GAUMER";
export const COMBO = "KXMVECROSSCATEGORY-S2026TEST-ABC";

// The user's own API key: the mock verifies every signed request with the public half.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
export const PEM = privateKey.export({ type: "pkcs1", format: "pem" });
export const KEY_ID = "a1b2c3d4-1111-2222-3333-444455556666";
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

export const markets: Record<string, any> = {
  [COMBO]: { ticker: COMBO, event_ticker: "KXMVECROSSCATEGORY-S2026TEST", status: "active", expected_expiration_time: soon.toISOString(), mve_selected_legs: [{ market_ticker: `${GAME}-LAD`, event_ticker: GAME, side: "yes" }] },
  [`${GAME}-LAD`]: { ticker: `${GAME}-LAD`, event_ticker: GAME, status: "active", yes_sub_title: "Los Angeles D", yes_bid_dollars: "0.55", yes_ask_dollars: "0.57" },
  [`${TENNIS}-MER`]: { ticker: `${TENNIS}-MER`, event_ticker: TENNIS, status: "active", yes_sub_title: "Elise Mertens", yes_bid_dollars: "0.40", yes_ask_dollars: "0.42" },
};

// Open NHL events for the watcher: a Colorado game tomorrow with markets, and one listed without markets yet.
const day = (n: number) => new Date(Date.now() + n * 864e5);
const tick = (d: Date) => `${String(d.getUTCFullYear()).slice(2)}${MON[d.getUTCMonth()]}${pad(d.getUTCDate())}`;
const nhl = (d: Date, away: string, home: string, title: string, markets: any[]) =>
  ({ event_ticker: `KXNHLGAME-${tick(d)}${away}${home}`, series_ticker: "KXNHLGAME", title, sub_title: `${away} vs ${home}`, markets });
export const watchEvents: Record<string, any[]> = {
  KXNHLGAME: [
    nhl(day(1), "COL", "CGY", "Colorado vs Calgary", [
      { ticker: "M-CGY", event_ticker: `KXNHLGAME-${tick(day(1))}COLCGY`, yes_sub_title: "Calgary", status: "active", yes_bid_dollars: "0.30", yes_ask_dollars: "0.31", volume_fp: "1500.00", occurrence_datetime: day(1).toISOString() },
      { ticker: "M-COL", event_ticker: `KXNHLGAME-${tick(day(1))}COLCGY`, yes_sub_title: "Colorado", status: "active", yes_bid_dollars: "0.69", yes_ask_dollars: "0.70", volume_fp: "2500.00", occurrence_datetime: day(1).toISOString() }]),
    nhl(day(9), "DAL", "COL", "Dallas vs Colorado", []),
    nhl(day(2), "EDM", "VAN", "Edmonton vs Vancouver", []),
  ],
};
export const watchCalls: string[] = [];

const SOME_PAGE = `<!doctype html><title>Some site</title><body>Hello</body>`;

// The background exposes its functions as `kaashify` on the service worker global (see src/background/index.ts).
declare const kaashify: any;

export interface Ext { context: BrowserContext; sw: Worker; extId: string; positionCalls: { cursor: string; filter: string | null }[] }

/** Launches Chromium with the built extension against the mocks. */
export async function launch(): Promise<Ext> {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    // Never reach the real Kalshi: anything the mocks don't catch fails to resolve.
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--host-resolver-rules=MAP *kalshi.com 0.0.0.0, MAP *.workers.dev 0.0.0.0"],
  });
  const positionCalls: Ext["positionCalls"] = [];
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
    // Market Watcher: open events of a series, and the sports series list for autocomplete.
    if (u.pathname.endsWith("/events")) {
      watchCalls.push(u.searchParams.get("series_ticker") || "");
      return route.fulfill({ json: { events: watchEvents[u.searchParams.get("series_ticker") || ""] ?? [], cursor: "" } });
    }
    if (u.pathname.endsWith("/series")) return route.fulfill({ json: { series: [{ ticker: "KXNHLGOAL", title: "NHL Goalscorer", tags: ["Hockey"] }] } });
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
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  return { context, sw, extId: new URL(sw.url()).host, positionCalls };
}

/** Waits out refreshes started by pages (each calendar page refreshes when it opens), so a test gets its own run. */
export const settle = (sw: Worker) => sw.evaluate(async () => { while (kaashify.running()) await kaashify.running(); });
export const storage = (sw: Worker, keys: string | string[] | null): Promise<Record<string, any>> => sw.evaluate((k) => chrome.storage.local.get(k), keys);

