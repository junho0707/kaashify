// Market Watcher logic: autocomplete, matching Kalshi events to watched items, and the fetch layer (fake API).
import { test } from "node:test";
import assert from "node:assert/strict";
import { type ApiEvent, type WatchItem, gameTitle, loadWatch, match, seriesFor, suggest, teamsOf } from "../src/lib/watch.ts";

const NOW = Date.parse("2026-10-08T16:00:00Z");
const mk = (ticker: string, sub: string, extra: Record<string, unknown> = {}) => ({ ticker, title: `${sub} wins`, yes_sub_title: sub, status: "active",
  yes_bid_dollars: "0.40", yes_ask_dollars: "0.42", volume_fp: "100.00", occurrence_datetime: "2026-10-09T02:00:00Z", ...extra });
const ev = (event_ticker: string, title: string, sub_title: string, markets: any[]): ApiEvent =>
  ({ event_ticker, series_ticker: event_ticker.split("-")[0], title, sub_title, markets });

const nhlGame = ev("KXNHLGAME-26OCT08COLCGY", "Colorado vs Calgary", "COL vs CGY (Oct 8)", [mk("KXNHLGAME-26OCT08COLCGY-CGY", "Calgary"), mk("KXNHLGAME-26OCT08COLCGY-COL", "Colorado")]);
const nhlOther = ev("KXNHLGAME-26OCT08DALBUF", "Dallas vs Buffalo", "DAL vs BUF (Oct 8)", [mk("KXNHLGAME-26OCT08DALBUF-DAL", "Dallas")]);
const nhlLater = ev("KXNHLGAME-26OCT20DALCOL", "Dallas vs Colorado", "DAL vs COL (Oct 20)", [mk("KXNHLGAME-26OCT20DALCOL-COL", "Colorado", { status: "initialized", occurrence_datetime: "2026-10-21T02:00:00Z" })]);
const spread = ev("KXNHLSPREAD-26OCT08COLCGY", "Colorado vs Calgary: Spread", "COL vs CGY (Oct 8)",
  Array.from({ length: 9 }, (_, i) => mk(`KXNHLSPREAD-26OCT08COLCGY-COL${i}`, `Colorado wins by over ${i + 0.5}`, { volume_fp: String(i) })));
const goals = ev("KXNHLGOAL-26OCT08COLCGY", "Colorado vs Calgary: Goals", "COL vs CGY (Oct 8)", [
  { ...mk("KXNHLGOAL-26OCT08COLCGY-COLNMACKINNON29-1", "x"), title: "Nathan MacKinnon: 1+ goals", yes_sub_title: "Nathan MacKinnon: 1+" },
  { ...mk("KXNHLGOAL-26OCT08COLCGY-CGYNKADRI91-1", "x"), title: "Nazem Kadri: 1+ goals", yes_sub_title: "Nazem Kadri: 1+" }]);
const pts = ev("KXNHLPTS-26OCT08COLCGY", "Colorado vs Calgary: Points", "COL vs CGY (Oct 8)", [
  { ...mk("KXNHLPTS-26OCT08COLCGY-COLNMACKINNON29-2", "x"), title: "Nathan MacKinnon: 2+ points", yes_sub_title: "Nathan MacKinnon: 2+" }]);
const bySeries = new Map<string, ApiEvent[]>([["KXNHLGAME", [nhlLater, nhlGame, nhlOther]], ["KXNHLSPREAD", [spread]], ["KXNHLTOTAL", []],
  ["KXNHLGOAL", [goals]], ["KXNHLPTS", [pts]], ["KXNHLAST", []]]);
const one = (q: string, kind: WatchItem["kind"]) => suggest(q).find((s) => s.kind === kind)!;

test("autocomplete: teams by nickname or city, leagues, players, tickers and Kalshi series", () => {
  assert.deepEqual(suggest("Avalanche")[0], { kind: "team", league: "NHL", code: "COL", name: "Colorado Avalanche", label: "Colorado Avalanche (NHL)", id: "team:NHL:COL" });
  assert.deepEqual(suggest("rangers").map((s) => s.kind), ["team", "team"], "a known team: no free-text searches");
  assert.deepEqual(suggest("rangers").filter((s) => s.kind === "team").map((s) => s.label), ["Texas Rangers (MLB)", "New York Rangers (NHL)"]);
  assert.equal(suggest("NHL")[0].id, "league:NHL");
  const eichel = suggest("Jack Eichel");
  assert.equal(eichel[0].kind, "player", "two words read as a person first");
  assert.ok(eichel.some((s) => s.id === "player:NHL:jack eichel"));
  assert.deepEqual(suggest("eichel nhl").map((s) => s.id), ["player:NHL:eichel"], "a league word narrows to that league");
  assert.equal(one("Arsenal", "team").label, "Arsenal: games (College football)");
  assert.ok(suggest("Arsenal").some((s) => s.id === "team:EPL:arsenal"));
  assert.ok(!suggest("Gauff").some((s) => s.id === "team:WTA:gauff"), "tennis players are players, not teams");
  assert.deepEqual(suggest("kxnhlgame-26oct08colcgy")[0], { kind: "event", ticker: "KXNHLGAME-26OCT08COLCGY", label: "Event KXNHLGAME-26OCT08COLCGY", id: "event:KXNHLGAME-26OCT08COLCGY" });
  assert.equal(suggest("goalscorer", [["KXNHLGOAL", "NHL Goalscorer", "Hockey"]])[0].id, "series:KXNHLGOAL");
  assert.deepEqual(suggest("a"), []);
});

test("team codes come from the sub-title, else from the ticker", () => {
  const codes = ["COL", "CGY", "NYR", "NY"];
  assert.deepEqual(teamsOf(nhlGame, codes), ["COL", "CGY"]);
  assert.deepEqual(teamsOf({ event_ticker: "KXNHLGAME-26OCT081900NYRCGY" }, codes), ["NYR", "CGY"]);
  assert.deepEqual(teamsOf({ event_ticker: "KXNHLGAME-26OCT08XXXYYY" }, codes), []);
  assert.equal(gameTitle("Colorado vs Calgary: Goals"), "Colorado vs Calgary");
  assert.equal(gameTitle("Game 4: Cleveland vs Chicago WS"), "Game 4: Cleveland vs Chicago WS");
});

test("a team: its games soonest first, winner/spread/total merged per game, markets capped", () => {
  const out = match(one("Avalanche", "team"), bySeries, NOW);
  assert.deepEqual(out.map((e) => e.key), ["26OCT08COLCGY", "26OCT20DALCOL"], "only Colorado's games, by time");
  const [g, later] = out;
  assert.equal(g.title, "Colorado vs Calgary");
  assert.equal(g.url, "https://kalshi.com/markets/kxnhlgame/kxnhlgame-26oct08colcgy");
  assert.deepEqual(g.markets.map((m) => m.label).slice(0, 4), ["Calgary", "Colorado", "Colorado wins by over 8.5", "Colorado wins by over 7.5"]);
  assert.equal(g.markets.length, 8);
  assert.equal(g.more, 3);
  assert.deepEqual(g.markets[0], { ticker: "KXNHLGAME-26OCT08COLCGY-CGY", label: "Calgary", yesBid: 0.4, yesAsk: 0.42, noBid: 0.58, noAsk: 0.6, volume: 100 });
  assert.equal(g.approx, true, "no ticker time: Kalshi's expected result time until the start is looked up");
  assert.deepEqual(later.markets, [], "listed, markets not open yet");
});

test("a player: only their markets, from every prop series, one entry per game", () => {
  const [g, ...rest] = match(one("MacKinnon NHL", "player"), bySeries, NOW);
  assert.equal(rest.length, 0);
  assert.equal(g.title, "Colorado vs Calgary");
  assert.deepEqual(g.markets.map((m) => m.label), ["Nathan MacKinnon: 2+ points", "Nathan MacKinnon: 1+ goals"]);
  assert.deepEqual(seriesFor(one("MacKinnon NHL", "player")), ["KXNHLPTS", "KXNHLGOAL", "KXNHLAST"]);
});

test("a league lists every upcoming game; games that started hours ago (over, not settled) are hidden", () => {
  const started = ev("KXNHLGAME-26OCT071900NYRCGY", "New York R vs Calgary", "NYR vs CGY (Oct 7)", [mk("KXNHLGAME-26OCT071900NYRCGY-NYR", "New York R")]);
  const m = new Map(bySeries).set("KXNHLGAME", [started, ...bySeries.get("KXNHLGAME")!]);
  assert.deepEqual(match(one("NHL", "league"), m, NOW).map((e) => e.ticker),
    ["KXNHLGAME-26OCT08COLCGY", "KXNHLGAME-26OCT08DALBUF", "KXNHLGAME-26OCT20DALCOL"]);
});

test("loading: each series fetched once for all items, start times looked up, errors kept per item", async () => {
  const calls: string[] = [];
  const deps = {
    series: async (t: string) => { calls.push(t); if (t === "KXNBAGAME") throw new Error("GET -> 500"); return bySeries.get(t) ?? []; },
    event: async (t: string) => (calls.push(t), t === "KXNHLGAME-26OCT08DALBUF" ? nhlOther : null),
    start: async (t: string) => (calls.push(`ms:${t}`), t === "KXNHLGAME-26OCT08COLCGY" ? Date.parse("2026-10-08T23:00:00Z") : null),
  };
  const list = [one("Avalanche", "team"), one("MacKinnon NHL", "player"), one("NHL", "league"), one("Lakers", "team"),
    suggest("KXNHLGAME-26OCT08DALBUF")[0], suggest("KXNHLGAME-26OCT01NOPE")[0]];
  const r = await loadWatch(list, deps, NOW);
  const fetched = calls.filter((c) => !c.startsWith("ms:"));
  assert.deepEqual([...fetched].sort(), ["KXNBAGAME", "KXNBASPREAD", "KXNBATOTAL", "KXNHLAST", "KXNHLGAME", "KXNHLGAME-26OCT01NOPE",
    "KXNHLGAME-26OCT08DALBUF", "KXNHLGOAL", "KXNHLPTS", "KXNHLSPREAD", "KXNHLTOTAL"], "no series twice");
  const col = r.items["team:NHL:COL"].events[0];
  assert.equal(col.start, Date.parse("2026-10-08T23:00:00Z"));
  assert.equal(col.approx, false);
  assert.equal(r.items["team:NBA:LAL"].error, "GET -> 500");
  assert.equal(r.items["event:KXNHLGAME-26OCT08DALBUF"].events[0].title, "Dallas vs Buffalo");
  assert.deepEqual(r.items["event:KXNHLGAME-26OCT01NOPE"], { events: [], error: null });
  assert.equal(calls.filter((c) => c === "ms:KXNHLGAME-26OCT08COLCGY").length, 1, "one start lookup per game");
});
