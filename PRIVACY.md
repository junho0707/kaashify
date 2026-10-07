# Privacy Policy: Kaashify

_Last updated: 2026-10-07_

**Short version: your data and your API key stay in your browser. Nothing is sent to the developer or anyone else.**

Kaashify is not affiliated with or endorsed by Kalshi.

## How it connects to Kalshi

You connect Kaashify with **your own Kalshi API key** (a Key ID and a private key file that you create on
kalshi.com under Account & security → API Keys). Kaashify uses it only to sign requests to Kalshi's official API
at `api.elections.kalshi.com`, the same way any Kalshi API client does. It does not read kalshi.com pages, your
password or your browser's Kalshi login.

Kaashify only makes **read** requests (HTTP GET). It never places, changes or cancels orders, and never moves money.

## What it reads

- **Your open positions** (`GET /portfolio/positions`), for the calendar.
- **Your fills** (`GET /portfolio/fills`), for the P&L tab.
- **Your balance** (`GET /portfolio/balance`), once, to check that a newly entered key works.
- **Public Kalshi market data** (prices, event names, start times, results, price history). These requests carry
  no key and nothing about you.
- **A realized P&L CSV export from Kalshi**, only if you choose to import one. It's read in your browser and never uploaded.

## What it stores, and where

Everything is kept only in the extension's storage in your browser:

| Data | Where | How long |
|---|---|---|
| Your API private key, imported as a **non-extractable** signing key (it can sign requests, but can't be read back out, not even by Kaashify) | extension IndexedDB | until you click Disconnect or Clear my data, or uninstall |
| The first 8 characters of your Key ID (shown in the footer) | local extension storage | same as above |
| Your open positions (ticker, contracts, cost, fees) and the calendar built from them | local extension storage | replaced on each refresh |
| Your fills (market, side, contracts, price, fee, time), for the P&L tab | local extension storage | replaced on each refresh |
| Trades from an imported P&L file (account ids are dropped) | local extension storage | until you remove it or clear everything |
| Event names, start times, results and price history (public) | local extension storage | cache |
| A log of the last 20 refreshes (time, counts, errors), with no personal data | local extension storage | rolling |
| Overlay size and position, theme | local extension storage / page storage | until changed |

**Disconnect** (Settings) deletes the key. **Clear all my data** (Settings) deletes everything. Uninstalling deletes everything.
You can also delete the key on kalshi.com at any time, which stops it working everywhere.

## Sharing

None. There is no Kaashify server, and no analytics, tracking, advertising or remote code.
"Save debug info" saves a file to your computer (tickers, times and refresh log; no amounts, no key); you choose
whether to send it to anyone.

## Permissions

| Permission | Why |
|---|---|
| Access to `api.elections.kalshi.com` | Kalshi's official API: your positions and fills (signed with your key) and public market data |
| `scripting`, `activeTab` | Show the calendar over the page you're on when you click the toolbar icon |
| `storage` | Keep the data listed above |
| `alarms` | Refresh every 30 minutes so the toolbar badge stays current |

## Contact

Open an issue at the project's GitHub repository.
