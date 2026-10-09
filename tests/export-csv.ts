// Synthetic rows in the column layout of Kalshi's realized P&L export.
const HEAD = "subtrader_id,type,quantity_fp,market_ticker,side,entry_price_dollars,exit_price_dollars,open_fees_dollars,close_fees_dollars,realized_pnl_without_fees_dollars,realized_pnl_with_fees_dollars,close_timestamp,open_timestamp";
const row = (q: number, t: string, side: string, entry: number, exit: number, fee: number, gross: number, net: number, close: string) => `00000000-0000-0000-0000-000000000000,trade,${q},${t},${side},${entry},${exit},${fee},0,${gross},${net},${close},2026-09-01T10:00:00-04:00`;
export const CSV = [HEAD,
  row(10, "KXNFLGAME-26SEP07KCLV-KC", "yes", 0.6, 1, 0.1, 4, 3.9, "2026-09-07T20:00:00-04:00"),
  row(10, "KXNFLGAME-26SEP14KCLV-KC", "no", 0.3, 0, 0.1, -3, -3.1, "2026-09-14T20:00:00-04:00"),
  row(20, "KXMVECROSSCATEGORY-S1-A", "yes", 0.05, 0, 0.02, -1, -1.02, "2026-09-15T20:00:00-04:00"),
  row(20, "KXMVECROSSCATEGORY-S1-B", "yes", 0.2, 1, 0.05, 16, 15.95, "2026-09-16T20:00:00-04:00"),
  row(5, "KXGOLD15M-26SEP161015-T1", "yes", 0.4, 0.55, 0.01, 0.75, 0.74, "\"2026-09-16T10:15:00-04:00\""),
].join("\r\n") + "\r\n";
