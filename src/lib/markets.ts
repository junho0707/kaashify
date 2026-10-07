// What a Kalshi ticker says about its market: start time, sport, and which part of the game a pick covers.

const MONTHS: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

// One formatter for every call: building Intl formatters is the slow part of time zone math.
const nyParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
  hour: "numeric", minute: "numeric", second: "numeric",
});

function nyOffsetMs(ts: number): number {
  const p: Record<string, number> = {};
  for (const { type, value } of nyParts.formatToParts(new Date(ts))) p[type] = Number(value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ts;
}

/**
 * Sports event tickers embed the scheduled start in US Eastern time, e.g. KXMLBTOTAL-26OCT071800LADATL
 * = Oct 7 2026, 6:00 PM ET. Date-only tickers (tennis, soccer) give `ts: null` and the day.
 */
export function startFromTicker(eventTicker: string): { ts: number | null; date: number | null } | null {
  const m = /-(\d{2})([A-Z]{3})(\d{2})(\d{4})?/.exec(eventTicker);
  if (!m || !(m[2] in MONTHS)) return null;
  const [y, mo, d] = [2000 + +m[1], MONTHS[m[2]], +m[3]];
  if (!m[4]) return { ts: null, date: Date.UTC(y, mo, d) };
  const wall = Date.UTC(y, mo, d, +m[4].slice(0, 2), +m[4].slice(2));
  // Two passes settle the offset across DST changes.
  const ts = wall - nyOffsetMs(wall - nyOffsetMs(wall));
  return { ts, date: null };
}

// --- Market type ------------------------------------------------------

// Kalshi's short pick text leaves out which part of the game a market covers: the first-5-innings total says
// "Over 6.5 runs" and the full-game total "Over 13.5 runs scored". The series ticker says it
// (KXMLBF5TOTAL vs KXMLBTOTAL), so each pick is labeled with its market type: "First 5 innings total: Over 6.5 runs".
const BET_TYPES: [string, string][] = [["TEAMTOTAL", "team total"], ["GTOTAL", "total games"], ["GSPREAD", "games spread"],
  ["SETWINNER", "set winner"], ["EXACTMATCH", "exact score"], ["TOTAL", "total"], ["SPREAD", "spread"], ["GAME", "winner"],
  ["MATCH", "winner"], ["FIGHT", "winner"]];
const PERIODS: [string, string][] = [["1Q", "1st quarter"], ["2Q", "2nd quarter"], ["3Q", "3rd quarter"], ["4Q", "4th quarter"],
  ["1H", "1st half"], ["2H", "2nd half"], ["F3", "First 3 innings"], ["F5", "First 5 innings"], ["F7", "First 7 innings"],
  ["1P", "1st period"], ["2P", "2nd period"], ["3P", "3rd period"]];

/** "KXMLBF5TOTAL" -> "First 5 innings total"; "KXMLBTOTAL" -> "Full game total"; unknown series -> null. */
export function marketKind(series: string): string | null {
  const s = String(series || "").replace(/^KX/, "");
  const type = BET_TYPES.find(([suf]) => s.endsWith(suf) && s.length > suf.length);
  const rest = type ? s.slice(0, -type[0].length) : s;
  const period = PERIODS.find(([suf]) => rest.endsWith(suf) && rest.length > suf.length);
  if (period) return `${period[1]} ${type ? type[1] : "winner"}`;
  if (!type) return null;
  if (type[0] === "TOTAL" || type[0] === "SPREAD") return `Full game ${type[1]}`;
  return type[1][0].toUpperCase() + type[1].slice(1);
}

const KIND_WORDS = / (total|spread|winner|team total|total games|games spread|set winner|exact score)$/i;

/** The pick with its market type in front, unless the text already says it ("First 5 innings: Over 6.5 runs"). */
export function pickLabel(series: string, pick: string): string {
  const kind = marketKind(series);
  if (!kind || !pick) return pick;
  const scope = kind.replace(KIND_WORDS, "");
  return pick.toLowerCase().includes(scope.toLowerCase()) && !/^full game$/i.test(scope) ? pick : `${kind}: ${pick}`;
}

// --- Sport / category ---------------------------------------------------

/** "KXNFLGAME-26OCT11KCLV-KC" -> "NFLGAME"; combos -> "Combos". */
export const seriesOf = (ticker: string): string => (/^KXMVE/.test(ticker) ? "Combos" : ticker.split("-")[0].replace(/^KX/, ""));

const CATEGORIES: [RegExp, string][] = [
  [/^(NFL|NCAAF|CFB|CFL|UFL)/, "Football"], [/^(NBA|WNBA|NCAAB|NCAAMB|NCAAWB|EUROLEAGUE)/, "Basketball"], [/^(MLB|KBO|NPB)/, "Baseball"],
  [/^(NHL|KHL|AHL)/, "Hockey"], [/^(ATP|WTA|ITF|CHALLENGER|TENNIS)/, "Tennis"],
  [/^(EPL|UCL|UECL|MLS|LALIGA|SERIEA|SERIEB|BUNDESLIGA|LIGUE|SOCCER|UEL|EFL|FACUP|LIGAMX|EREDIVISIE|BRASILEIRAO|FIFA|WC|UEFA|ARGPREMDIV|SPL|CHAMPIONS)/, "Soccer"],
  [/^(LOL|CS2?|DOTA|VAL|OW|R6)/, "Esports"], [/^(T20|ODI|TEST|IPL|CRICKET)/, "Cricket"], [/^(UFC|MMA|BOX)/, "Fighting"],
  [/^(NCAAWV|NCAAMV|VOLLEY)/, "Volleyball"], [/^RUGBY/, "Rugby"], [/^(PGA|LPGA|LIV|GOLF)/, "Golf"], [/^(F1|NASCAR|INDY)/, "Racing"],
  [/^(GOLD|SILVER|PALLADIUM|PLATINUM|COPPER|NATGAS|OIL|WTI|BRENT)/, "Commodities"],
  [/^(INX|NASDAQ|SPX|BTC|ETH|SOL|XRP|DOGE|EUR|USD|JPY)/, "Markets"],
];

/** Broad category from the ticker's series ("Football", "Tennis", …); "Combos" for combos, else "Other". */
export function categoryOf(ticker: string): string {
  if (/^KXMVE/.test(ticker)) return "Combos";
  const s = seriesOf(ticker);
  return CATEGORIES.find(([re]) => re.test(s))?.[1] ?? "Other";
}
