# Contributing to Kaashify

Thanks for helping out! Kaashify is a small, dependency-free browser extension, and the goal is to keep it that way.

## Getting started

```sh
git clone https://github.com/junho0707/kaashify.git
cd kaashify
npm install
npm test
```

Run `npm run dev` and load `dist/chromium` in your browser (`chrome://extensions` → Developer mode → **Load unpacked**),
then connect a Kalshi API key. After you change something, click **Reload** on the extensions page and reopen the calendar.

You don't need a funded Kalshi account to work on most things: `npm run e2e` and `npm run screenshots` run the real
extension against a mocked Kalshi API with demo data.

## Before you open a pull request

- `npm run typecheck`, `npm test` and `npm run e2e` pass (CI runs all three).
- New behavior has a test: pure logic in `tests/*.test.ts`, UI in `tests/render.test.ts` (jsdom), and end-to-end
  flows in `e2e/`.
- No new runtime dependencies or remote code. Extension stores reject remotely loaded code, and users trust the
  extension with an API key.
- Keep requests **read-only** (`GET`). Kaashify must never place orders or move money.
- Match the surrounding style: strict TypeScript, small pure functions, short comments that explain *why*. Code in
  `src/lib/` stays free of DOM and `chrome.*` calls so it can be unit-tested.

## Reporting bugs

Open an [issue](https://github.com/junho0707/kaashify/issues/new/choose). In the extension, **Settings → Save debug
info** creates a file with tickers, times and the refresh log (no amounts, no key). Attach it if you're comfortable
sharing it.

## Security

Found a problem with how the API key is handled? Please don't open a public issue. Use GitHub's
[private vulnerability reporting](https://github.com/junho0707/kaashify/security/advisories/new) instead.
