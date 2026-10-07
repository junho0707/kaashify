import { defineConfig } from "@playwright/test";

// Loads the built extension (dist/chromium; `npm run e2e` builds it first) in Chromium against a mocked Kalshi API.
export default defineConfig({ testDir: ".", timeout: 60000, retries: 0, workers: 1, outputDir: "../test-results" });
