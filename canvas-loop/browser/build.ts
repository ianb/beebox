// Bundles the browser playground into ONE self-contained HTML file — every
// module inlined, zero runtime imports, no external requests (it is published
// behind a strict CSP). esbuild bundles browser/app.ts (runtime + the five
// sketches) to an IIFE; this script wraps it in a dark, minimal HTML shell with
// inline CSS. Regenerate with `pnpm --dir canvas-loop run build:playground`.
import { build } from "esbuild";
import type { OnResolveArgs, Plugin } from "esbuild";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const HERE = import.meta.dirname;
const ENTRY = resolve(HERE, "app.ts");
const OUT_DIR = resolve(HERE, "dist");
const OUT_FILE = resolve(OUT_DIR, "playground.html");

// The repo writes NodeNext `.js` import specifiers that point at `.ts` sources;
// esbuild resolves real files, so remap each relative `.js` to its `.ts`.
const tsResolve: Plugin = {
  name: "ts-from-js-specifier",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /\.js$/ }, (args: OnResolveArgs) => {
      if (!args.path.startsWith(".")) return null;
      const tsPath = resolve(args.resolveDir, args.path).replace(/\.js$/, ".ts");
      return existsSync(tsPath) ? { path: tsPath } : null;
    });
  },
};

function renderHtml(js: string): string {
  // Neutralise any `</script>` that could close the inline block early.
  const safe = js.replace(/<\/script>/gi, "<\\/script>");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>canvas-loop playground</title>
<style>${CSS}</style>
</head>
<body>
<div id="app"></div>
<script>${safe}</script>
</body>
</html>
`;
}

const CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  background: #0b0e17;
  color: #e2e8f0;
  font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.playground { max-width: 1100px; margin: 0 auto; padding: 16px; }
.topbar { display: flex; align-items: baseline; gap: 20px; flex-wrap: wrap; margin-bottom: 16px; }
.title { font-size: 18px; font-weight: 600; margin: 0; color: #f8fafc; }
.tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.tab {
  background: #161b2b; color: #cbd5e1; border: 1px solid #26304a;
  border-radius: 6px; padding: 6px 12px; cursor: pointer; font: inherit;
}
.tab:hover { border-color: #3b4a70; }
.tab.active { background: #2563eb; border-color: #2563eb; color: #fff; }
.stage { display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap; }
.canvas-col { display: flex; flex-direction: column; gap: 10px; }
.canvas-wrap {
  background: #05070d; border: 1px solid #26304a; border-radius: 8px;
  padding: 10px; display: inline-flex;
}
.sketch-canvas { display: block; image-rendering: pixelated; outline: none; cursor: crosshair; }
.sketch-canvas:focus { box-shadow: 0 0 0 2px #2563eb; }
.toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.frame-readout { font-variant-numeric: tabular-nums; color: #94a3b8; min-width: 84px; }
.ctl-btn {
  background: #1e2740; color: #e2e8f0; border: 1px solid #35406a;
  border-radius: 6px; padding: 5px 12px; cursor: pointer; font: inherit;
}
.ctl-btn:hover { background: #27314f; }
.ctl-btn.wide { width: 100%; margin-bottom: 8px; }
.toolbar-field { display: inline-flex; align-items: center; gap: 6px; color: #94a3b8; }
.seed-input { width: 72px; background: #10141f; color: #e2e8f0; border: 1px solid #35406a; border-radius: 5px; padding: 4px 6px; font: inherit; }
.side { flex: 1 1 300px; min-width: 280px; display: flex; flex-direction: column; gap: 16px; }
.panel { background: #10141f; border: 1px solid #202a44; border-radius: 8px; padding: 12px 14px; }
.panel-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin: 0 0 10px; }
.params { display: flex; flex-direction: column; gap: 10px; }
.param-row { display: grid; grid-template-columns: 96px 1fr; align-items: center; gap: 10px; }
.param-name { color: #cbd5e1; font-size: 13px; overflow-wrap: anywhere; }
.range-holder { display: flex; align-items: center; gap: 8px; }
.range-holder input { flex: 1; }
.param-value { min-width: 40px; text-align: right; font-variant-numeric: tabular-nums; color: #93c5fd; }
.trigger-btn { background: #3b2a5a; color: #e9d5ff; border: 1px solid #5b3fa0; border-radius: 6px; padding: 5px 12px; cursor: pointer; font: inherit; }
.trigger-btn:hover { background: #4a357099; }
select, input[type="range"] { accent-color: #2563eb; }
select { background: #10141f; color: #e2e8f0; border: 1px solid #35406a; border-radius: 5px; padding: 4px; font: inherit; }
.muted { color: #64748b; font-style: italic; margin: 0; }
.events-area { width: 100%; background: #05070d; color: #cbd5e1; border: 1px solid #26304a; border-radius: 6px; font: 12px/1.4 ui-monospace, monospace; margin-top: 8px; resize: vertical; }
summary { cursor: pointer; color: #93c5fd; }
.log { background: #05070d; border: 1px solid #202a44; border-radius: 6px; padding: 8px; margin: 0; max-height: 160px; overflow: auto; font: 12px/1.45 ui-monospace, monospace; color: #9fb3c8; white-space: pre-wrap; }
`;

async function main(): Promise<void> {
  const result = await build({
    entryPoints: [ENTRY],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["es2022"],
    minify: true,
    write: false,
    plugins: [tsResolve],
    logLevel: "warning",
  });
  const output = result.outputFiles[0];
  if (output === undefined) throw new BuildError({ detail: "esbuild produced no output" });
  const html = renderHtml(output.text);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, html);
  const kib = (Buffer.byteLength(html) / 1024).toFixed(1);
  console.log(`${OUT_FILE} — ${kib} KiB`);
}

class BuildError extends Error {
  name = "BuildError";
  constructor(options: { detail: string }) {
    super(`build: ${options.detail}`);
  }
}

await main();
