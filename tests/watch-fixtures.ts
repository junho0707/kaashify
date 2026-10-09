// Watch tab fixtures shared by the free and Pro render tests.
const H = 3600e3;
export const col = { id: "team:NHL:COL", kind: "team", league: "NHL", code: "COL", name: "Colorado Avalanche", label: "Colorado Avalanche (NHL)" };
export const quinn = { id: "player:NHL:jack quinn", kind: "player", league: "NHL", name: "Jack Quinn", label: "Jack Quinn: player markets (NHL)" };
const mkt = (label: string, yesBid: number, yesAsk: number) => ({ ticker: `T-${label}`, label, yesBid, yesAsk, noBid: +(1 - yesAsk).toFixed(2), noAsk: +(1 - yesBid).toFixed(2), volume: 12345 });
export const results = { at: Date.now(), items: {
  [col.id]: { events: [
    { key: "A", ticker: "KXNHLGAME-26OCT08COLCGY", series: "KXNHLGAME", title: "Colorado vs Calgary", sub: "COL vs CGY (Oct 8)", start: Date.now() + 2 * H, approx: false,
      url: "https://kalshi.com/markets/kxnhlgame/kxnhlgame-26oct08colcgy", markets: [mkt("Calgary", 0.3, 0.31), mkt("Colorado", 0.69, 0.7)], more: 7 },
    { key: "B", ticker: "KXNHLGAME-26OCT20DALCOL", series: "KXNHLGAME", title: "Dallas vs Colorado", sub: "", start: Date.now() + 200 * H, approx: true,
      url: "https://kalshi.com/markets/kxnhlgame/kxnhlgame-26oct20dalcol", markets: [], more: 0 }] },
} };

export function setup(sent: any[]) {
  return (w: any, store: any) => {
    Object.assign(store, { watchlist: [col, quinn], watchResults: results });
    w.chrome.storage.local.set = async (v: any) => Object.assign(store, v);
    w.chrome.runtime.sendMessage = async (m: any) => {
      sent.push(m);
      return m.type === "watch-series" ? { ok: true, list: [["KXNHLGOAL", "NHL Goalscorer", "Hockey"]] } : {};
    };
  };
}

