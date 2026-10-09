// Leagues the Market Watcher knows: which Kalshi series hold their games and their player props, and the team
// codes Kalshi uses in event tickers and sub-titles ("DAL vs BUF (Oct 8)"). Kalshi's titles use cities
// ("Dallas vs Buffalo"), so nicknames ("Stars") are mapped here. Codes checked against Kalshi's API, 2026-10.

export interface League {
  key: string;
  name: string;
  /** Game series: the first is the main one (winner); the others are shown under the same game. */
  game: string[];
  /** Series with one market per player (props, or the match winner in tennis / fighting). */
  props: string[];
  /** [Kalshi code, city as Kalshi writes it, nickname]. */
  teams?: [string, string, string][];
}

const NHL: [string, string, string][] = [
  ["ANA", "Anaheim", "Ducks"], ["BOS", "Boston", "Bruins"], ["BUF", "Buffalo", "Sabres"], ["CAR", "Carolina", "Hurricanes"],
  ["CBJ", "Columbus", "Blue Jackets"], ["CGY", "Calgary", "Flames"], ["CHI", "Chicago", "Blackhawks"], ["COL", "Colorado", "Avalanche"],
  ["DAL", "Dallas", "Stars"], ["DET", "Detroit", "Red Wings"], ["EDM", "Edmonton", "Oilers"], ["FLA", "Florida", "Panthers"],
  ["LA", "Los Angeles", "Kings"], ["MIN", "Minnesota", "Wild"], ["MTL", "Montreal", "Canadiens"], ["NJ", "New Jersey", "Devils"],
  ["NSH", "Nashville", "Predators"], ["NYI", "New York", "Islanders"], ["NYR", "New York", "Rangers"], ["OTT", "Ottawa", "Senators"],
  ["PHI", "Philadelphia", "Flyers"], ["PIT", "Pittsburgh", "Penguins"], ["SEA", "Seattle", "Kraken"], ["SJ", "San Jose", "Sharks"],
  ["STL", "St. Louis", "Blues"], ["TB", "Tampa Bay", "Lightning"], ["TOR", "Toronto", "Maple Leafs"], ["UTA", "Utah", "Mammoth"],
  ["VAN", "Vancouver", "Canucks"], ["VGK", "Vegas", "Golden Knights"], ["WPG", "Winnipeg", "Jets"], ["WSH", "Washington", "Capitals"],
];
const NBA: [string, string, string][] = [
  ["ATL", "Atlanta", "Hawks"], ["BOS", "Boston", "Celtics"], ["BKN", "Brooklyn", "Nets"], ["CHA", "Charlotte", "Hornets"],
  ["CHI", "Chicago", "Bulls"], ["CLE", "Cleveland", "Cavaliers"], ["DAL", "Dallas", "Mavericks"], ["DEN", "Denver", "Nuggets"],
  ["DET", "Detroit", "Pistons"], ["GSW", "Golden State", "Warriors"], ["HOU", "Houston", "Rockets"], ["IND", "Indiana", "Pacers"],
  ["LAC", "Los Angeles", "Clippers"], ["LAL", "Los Angeles", "Lakers"], ["MEM", "Memphis", "Grizzlies"], ["MIA", "Miami", "Heat"],
  ["MIL", "Milwaukee", "Bucks"], ["MIN", "Minnesota", "Timberwolves"], ["NOP", "New Orleans", "Pelicans"], ["NYK", "New York", "Knicks"],
  ["OKC", "Oklahoma City", "Thunder"], ["ORL", "Orlando", "Magic"], ["PHI", "Philadelphia", "76ers"], ["PHX", "Phoenix", "Suns"],
  ["POR", "Portland", "Trail Blazers"], ["SAC", "Sacramento", "Kings"], ["SAS", "San Antonio", "Spurs"], ["TOR", "Toronto", "Raptors"],
  ["UTA", "Utah", "Jazz"], ["WAS", "Washington", "Wizards"],
];
const NFL: [string, string, string][] = [
  ["ARI", "Arizona", "Cardinals"], ["ATL", "Atlanta", "Falcons"], ["BAL", "Baltimore", "Ravens"], ["BUF", "Buffalo", "Bills"],
  ["CAR", "Carolina", "Panthers"], ["CHI", "Chicago", "Bears"], ["CIN", "Cincinnati", "Bengals"], ["CLE", "Cleveland", "Browns"],
  ["DAL", "Dallas", "Cowboys"], ["DEN", "Denver", "Broncos"], ["DET", "Detroit", "Lions"], ["GB", "Green Bay", "Packers"],
  ["HOU", "Houston", "Texans"], ["IND", "Indianapolis", "Colts"], ["JAC", "Jacksonville", "Jaguars"], ["KC", "Kansas City", "Chiefs"],
  ["LAC", "Los Angeles", "Chargers"], ["LAR", "Los Angeles", "Rams"], ["LV", "Las Vegas", "Raiders"], ["MIA", "Miami", "Dolphins"],
  ["MIN", "Minnesota", "Vikings"], ["NE", "New England", "Patriots"], ["NO", "New Orleans", "Saints"], ["NYG", "New York", "Giants"],
  ["NYJ", "New York", "Jets"], ["PHI", "Philadelphia", "Eagles"], ["PIT", "Pittsburgh", "Steelers"], ["SEA", "Seattle", "Seahawks"],
  ["SF", "San Francisco", "49ers"], ["TB", "Tampa Bay", "Buccaneers"], ["TEN", "Tennessee", "Titans"], ["WAS", "Washington", "Commanders"],
];
const MLB: [string, string, string][] = [
  ["ATH", "Athletics", "A's"], ["ATL", "Atlanta", "Braves"], ["AZ", "Arizona", "Diamondbacks"], ["BAL", "Baltimore", "Orioles"],
  ["BOS", "Boston", "Red Sox"], ["CHC", "Chicago", "Cubs"], ["CIN", "Cincinnati", "Reds"], ["CLE", "Cleveland", "Guardians"],
  ["COL", "Colorado", "Rockies"], ["CWS", "Chicago", "White Sox"], ["DET", "Detroit", "Tigers"], ["HOU", "Houston", "Astros"],
  ["KC", "Kansas City", "Royals"], ["LAA", "Los Angeles", "Angels"], ["LAD", "Los Angeles", "Dodgers"], ["MIA", "Miami", "Marlins"],
  ["MIL", "Milwaukee", "Brewers"], ["MIN", "Minnesota", "Twins"], ["NYM", "New York", "Mets"], ["NYY", "New York", "Yankees"],
  ["PHI", "Philadelphia", "Phillies"], ["PIT", "Pittsburgh", "Pirates"], ["SD", "San Diego", "Padres"], ["SEA", "Seattle", "Mariners"],
  ["SF", "San Francisco", "Giants"], ["STL", "St. Louis", "Cardinals"], ["TB", "Tampa Bay", "Rays"], ["TEX", "Texas", "Rangers"],
  ["TOR", "Toronto", "Blue Jays"], ["WSH", "Washington", "Nationals"],
];
const WNBA: [string, string, string][] = [
  ["ATL", "Atlanta", "Dream"], ["CHI", "Chicago", "Sky"], ["CONN", "Connecticut", "Sun"], ["DAL", "Dallas", "Wings"],
  ["GS", "Golden State", "Valkyries"], ["IND", "Indiana", "Fever"], ["LA", "Los Angeles", "Sparks"], ["LV", "Las Vegas", "Aces"],
  ["MIN", "Minnesota", "Lynx"], ["NY", "New York", "Liberty"], ["PDX", "Portland", "Fire"], ["PHX", "Phoenix", "Mercury"],
  ["SEA", "Seattle", "Storm"], ["TOR", "Toronto", "Tempo"], ["WSH", "Washington", "Mystics"],
];

const soccer = (key: string, name: string, s: string): League =>
  ({ key, name, game: [`KX${s}GAME`, `KX${s}SPREAD`, `KX${s}TOTAL`], props: [`KX${s}GOAL`] });

export const LEAGUES: League[] = [
  { key: "NFL", name: "NFL", game: ["KXNFLGAME", "KXNFLSPREAD", "KXNFLTOTAL"], props: ["KXNFLANYTD", "KXNFLPASSYDS", "KXNFLRECYDS", "KXNFLREC"], teams: NFL },
  { key: "NBA", name: "NBA", game: ["KXNBAGAME", "KXNBASPREAD", "KXNBATOTAL"], props: ["KXNBAPTS", "KXNBAREB", "KXNBAAST", "KXNBA3PT"], teams: NBA },
  { key: "MLB", name: "MLB", game: ["KXMLBGAME", "KXMLBSPREAD", "KXMLBTOTAL"], props: ["KXMLBHIT", "KXMLBHR", "KXMLBKS", "KXMLBHRR"], teams: MLB },
  { key: "NHL", name: "NHL", game: ["KXNHLGAME", "KXNHLSPREAD", "KXNHLTOTAL"], props: ["KXNHLPTS", "KXNHLGOAL", "KXNHLAST"], teams: NHL },
  { key: "WNBA", name: "WNBA", game: ["KXWNBAGAME", "KXWNBASPREAD", "KXWNBATOTAL"], props: ["KXWNBAPTS", "KXWNBAREB", "KXWNBAAST", "KXWNBA3PT"], teams: WNBA },
  { key: "NCAAF", name: "College football", game: ["KXNCAAFGAME", "KXNCAAFSPREAD", "KXNCAAFTOTAL"], props: [] },
  { key: "NCAAMB", name: "College basketball", game: ["KXNCAAMBGAME", "KXNCAAMBSPREAD", "KXNCAAMBTOTAL"], props: [] },
  { key: "ATP", name: "ATP tennis", game: ["KXATPMATCH"], props: ["KXATPMATCH"] },
  { key: "WTA", name: "WTA tennis", game: ["KXWTAMATCH"], props: ["KXWTAMATCH"] },
  { key: "UFC", name: "UFC", game: ["KXUFCFIGHT"], props: ["KXUFCFIGHT"] },
  soccer("EPL", "Premier League", "EPL"),
  soccer("UCL", "Champions League", "UCL"),
  soccer("LALIGA", "La Liga", "LALIGA"),
  soccer("MLS", "MLS", "MLS"),
];

export const leagueOf = (key: string): League | undefined => LEAGUES.find((l) => l.key === key);
