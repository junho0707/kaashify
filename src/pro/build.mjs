// Build settings for the extras (trade table, CSV, breakdown, alerts), loaded by scripts/build.mjs.
import { readFileSync } from "node:fs";

export function pro() {
  return {
    entryPoints: [
      { in: "src/pro/background.ts", out: "background" },
      { in: "src/pro/calendar.ts", out: "calendar" },
      { in: "src/pro/calendar.css", out: "calendar" },
    ],
    // Description and the optional notifications permission (alerts).
    manifest: JSON.parse(readFileSync(new URL("manifest.json", import.meta.url), "utf8")),
  };
}
