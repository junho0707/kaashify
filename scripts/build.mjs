// Builds the extension from src/ (TypeScript, bundled by esbuild) and extension/ (manifest, HTML, icons):
//   dist/chromium/  and  dist/firefox/                       load these unpacked while developing
//   dist/kaashify-{chromium,firefox}-<version>.zip           store uploads (Chromium: Edge, Chrome, Brave, Opera)
// Usage: node scripts/build.mjs [--watch] [--free]
//   --watch   rebuilds dist/chromium on every change, no zips
//   --free    the base version without the extras overlay (src/pro/build.mjs: trade table, breakdown, alerts)
import * as esbuild from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

const root = new URL("..", import.meta.url).pathname;
const dist = join(root, "dist");
const WATCH = process.argv.includes("--watch");
// The extras overlay can swap the entry points and add manifest keys and build-time constants.
const overlayPath = join(root, "src/pro/build.mjs");
const overlay = existsSync(overlayPath) && !process.argv.includes("--free") ? (await import(overlayPath)).pro() : null;
const manifest = { ...JSON.parse(readFileSync(join(root, "extension/manifest.json"), "utf8")), ...overlay?.manifest };

// Ed25519 keys need Firefox 129+. Nothing is collected or sent to the developer.
const dataCollection = overlay?.dataCollection ?? { required: ["none"] };
const targets = {
  chromium: manifest,
  firefox: {
    ...manifest,
    background: { scripts: ["background.js"] },
    browser_specific_settings: { gecko: { id: "kaashify@kaashify", strict_min_version: "129.0", data_collection_permissions: dataCollection } },
  },
};

/** esbuild options for one output folder: two self-contained scripts and the stylesheet. */
const options = (outdir) => ({
  entryPoints: overlay?.entryPoints ?? [
    { in: "src/background/index.ts", out: "background" },
    { in: "src/calendar/index.ts", out: "calendar" },
    { in: "src/calendar/calendar.css", out: "calendar" },
  ],
  define: overlay?.define ?? {},
  absWorkingDir: root,
  outdir,
  bundle: true,
  format: "iife",
  target: ["chrome120", "firefox129"],
  // Readable output: store reviewers read it, and there's nothing to gain from minifying a local extension.
  minify: false,
  sourcemap: WATCH ? "inline" : false,
  legalComments: "none",
  logLevel: "warning",
});

function copyStatic(outdir, m) {
  cpSync(join(root, "extension"), outdir, { recursive: true, filter: (src) => !src.endsWith("manifest.json") });
  writeFileSync(join(outdir, "manifest.json"), JSON.stringify(m, null, 2));
  cpSync(join(root, "LICENSE"), join(outdir, "LICENSE"));
}

// Dev only (--watch): the extension polls dev-build.json and reloads itself. A background or extension/ change
// reloads the whole extension (and reopens the calendar if it was open); a calendar-only change reloads the page.
const DEV_RELOAD = `(() => {
  const url = chrome.runtime.getURL("dev-build.json");
  const sw = typeof window === "undefined";
  let last = null;
  if (sw) chrome.storage.local.get("devReopen").then(({ devReopen }) => {
    if (devReopen) chrome.storage.local.remove("devReopen").then(() => chrome.tabs.create({ url: chrome.runtime.getURL("calendar.html") }));
  });
  const tick = async () => {
    try {
      const s = await (await fetch(url, { cache: "no-store" })).json();
      if (last && sw && s.bg !== last.bg) {
        const tabs = await chrome.runtime.getContexts({ contextTypes: ["TAB"] }).catch(() => []);
        if (tabs.some((t) => t.documentUrl?.includes("calendar.html") && !t.documentUrl.includes("embed=1"))) await chrome.storage.local.set({ devReopen: true });
        chrome.runtime.reload();
      } else if (last && !sw && s.ui !== last.ui) location.reload();
      last = s;
    } catch {}
  };
  setInterval(tick, 1000);
  tick();
})();`;

if (WATCH) {
  const out = join(dist, "chromium");
  const m = targets.chromium;
  mkdirSync(out, { recursive: true });
  copyStatic(out, m);
  let staticGen = 0;
  const hash = (...fs) => crc32(Buffer.concat(fs.map((f) => (existsSync(join(out, f)) ? readFileSync(join(out, f)) : Buffer.alloc(0)))));
  const stamp = () => writeFileSync(join(out, "dev-build.json"),
    JSON.stringify({ bg: `${hash("background.js")}-${staticGen}`, ui: `${hash("calendar.js", "calendar.css")}-${staticGen}` }));
  const devReload = { name: "dev-reload", setup: (b) => b.onEnd((r) => { if (!r.errors.length) stamp(); }) };
  const ctx = await esbuild.context({ ...options(out), banner: { js: DEV_RELOAD }, plugins: [devReload] });
  await ctx.watch();
  let timer;
  watch(join(root, "extension"), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => { copyStatic(out, m); staticGen++; stamp(); console.log("extension/ copied"); }, 200);
  });
  console.log(`watching src/ + extension/ -> ${relative(root, out)} (load it unpacked once; it reloads itself on changes)`);
} else {
  for (const [name, m] of Object.entries(targets)) {
    const out = join(dist, name);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    copyStatic(out, m);
    await esbuild.build(options(out));
    const zipPath = join(dist, `kaashify-${name}-${manifest.version}.zip`);
    const entries = files(out).map((f) => [relative(out, f).split("\\").join("/"), readFileSync(f)]);
    writeFileSync(zipPath, zip(entries));
    console.log(`${relative(root, zipPath)}  (${entries.length} files)`);
  }
  sourceZip();
}

/** Firefox reviewers need the source of bundled code: what's needed to rebuild the extension, nothing else. */
function sourceZip() {
  const keep = ["src", "extension", "scripts", "package.json", "package-lock.json", "tsconfig.json", "LICENSE"];
  const entries = keep.flatMap((p) => (statSync(join(root, p)).isDirectory() ? files(join(root, p)) : [join(root, p)]))
    .map((f) => [relative(root, f).split("\\").join("/"), readFileSync(f)]);
  entries.push(["SOURCE.md", Buffer.from(`# Kaashify ${manifest.version}: build from source\n\nNode 22.18+, then:\n\n    npm ci\n    npm run build\n\n` +
    "dist/firefox/ is the Firefox add-on (also zipped as dist/kaashify-firefox-<version>.zip). esbuild bundles the\n" +
    "TypeScript in src/ into background.js and calendar.js without minifying; the files in extension/ are copied as-is.\n")]);
  const zipPath = join(dist, `kaashify-source-${manifest.version}.zip`);
  writeFileSync(zipPath, zip(entries));
  console.log(`${relative(root, zipPath)}  (${entries.length} files, for Firefox review)`);
}

function files(dir) {
  return readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)])).sort();
}

/** A minimal deflate zip writer (no dependency). */
function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const comp = deflateRawSync(data), crc = crc32(data), n = Buffer.from(name);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    locals.push(h, n, comp); centrals.push(c, n);
    offset += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
