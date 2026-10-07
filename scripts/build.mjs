// Builds the extension from src/ (TypeScript, bundled by esbuild) and extension/ (manifest, HTML, icons):
//   dist/chromium/  and  dist/firefox/                       load these unpacked while developing
//   dist/kaashify-{chromium,firefox}-<version>.zip           store uploads (Chromium: Edge, Chrome, Brave, Opera)
// Usage: node scripts/build.mjs [--watch]   (--watch rebuilds dist/chromium on every change, no zips)
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

const root = new URL("..", import.meta.url).pathname;
const dist = join(root, "dist");
const WATCH = process.argv.includes("--watch");
const manifest = JSON.parse(readFileSync(join(root, "extension/manifest.json"), "utf8"));

const targets = {
  chromium: manifest,
  firefox: {
    ...manifest,
    background: { scripts: ["background.js"] },
    // Ed25519 keys need Firefox 129+. Nothing is collected or sent to the developer.
    browser_specific_settings: { gecko: { id: "kaashify@kaashify", strict_min_version: "129.0", data_collection_permissions: { required: ["none"] } } },
  },
};

/** esbuild options for one output folder: two self-contained scripts and the stylesheet. */
const options = (outdir) => ({
  entryPoints: [
    { in: "src/background/index.ts", out: "background" },
    { in: "src/calendar/index.ts", out: "calendar" },
    { in: "src/calendar/calendar.css", out: "calendar" },
  ],
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

if (WATCH) {
  const out = join(dist, "chromium");
  mkdirSync(out, { recursive: true });
  copyStatic(out, targets.chromium);
  const ctx = await esbuild.context(options(out));
  await ctx.watch();
  console.log(`watching src/ -> ${relative(root, out)} (load that folder unpacked; reload the extension after changes)`);
} else {
  rmSync(dist, { recursive: true, force: true });
  for (const [name, m] of Object.entries(targets)) {
    const out = join(dist, name);
    mkdirSync(out, { recursive: true });
    copyStatic(out, m);
    await esbuild.build(options(out));
    const zipPath = join(dist, `kaashify-${name}-${manifest.version}.zip`);
    const entries = files(out).map((f) => [relative(out, f).split("\\").join("/"), readFileSync(f)]);
    writeFileSync(zipPath, zip(entries));
    console.log(`${relative(root, zipPath)}  (${entries.length} files)`);
  }
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
