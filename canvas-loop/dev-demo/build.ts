// Bundles the <SketchFigure> dev demo into ONE self-contained HTML file at the
// monorepo dev/ directory, served at /<worktree>/dev/canvas-loop.html straight
// from disk (so it never cold-starts the worktree). esbuild bundles
// dev-demo/main.tsx (React + the component + two sketches) to an IIFE with the
// automatic JSX runtime; this script wraps it in a light HTML shell with inline
// CSS. The output HTML is TRACKED — regenerate after touching the demo or the
// component with:  pnpm --dir canvas-loop run build:dev-demo
import { build } from "esbuild";
import type { OnResolveArgs, Plugin } from "esbuild";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const HERE = import.meta.dirname;
const ENTRY = resolve(HERE, "main.tsx");
const OUT_FILE = resolve(HERE, "../../dev/canvas-loop.html");

// The repo writes NodeNext `.js` import specifiers that point at `.ts`/`.tsx`
// sources; esbuild resolves real files, so remap each relative `.js` to its
// `.ts` or `.tsx` sibling.
const tsResolve: Plugin = {
  name: "ts-from-js-specifier",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /\.js$/ }, (args: OnResolveArgs) => {
      if (!args.path.startsWith(".")) return null;
      const base = resolve(args.resolveDir, args.path).replace(/\.js$/, "");
      for (const ext of [".ts", ".tsx"]) {
        if (existsSync(base + ext)) return { path: base + ext };
      }
      return null;
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
<title>canvas-loop · SketchFigure demo</title>
<style>${CSS}</style>
</head>
<body>
<div id="app"></div>
<footer class="demo-footer">
  Generated file — do not edit by hand. Rebuild with
  <code>pnpm --dir canvas-loop run build:dev-demo</code> (source: canvas-loop/dev-demo/).
</footer>
<script>${safe}</script>
</body>
</html>
`;
}

const CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #f8fafc; color: #1e293b; font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.demo { max-width: 760px; margin: 0 auto; padding: 24px 16px 8px; }
.demo-header h1 { font-size: 22px; margin: 0 0 6px; }
.demo-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px 18px; margin: 20px 0; }
.demo-card h2 { font-size: 16px; margin: 0 0 8px; }
.demo-note { color: #475569; font-size: 14px; margin: 6px 0; }
.demo-watch { font-size: 14px; }
code { background: #eef2ff; border-radius: 4px; padding: 1px 5px; font: 12px/1.5 ui-monospace, monospace; }
.demo-link { background: none; border: none; color: #2563eb; cursor: pointer; font: inherit; text-decoration: underline; padding: 0; }
.demo-footer { max-width: 760px; margin: 8px auto 32px; padding: 0 16px; color: #94a3b8; font-size: 12px; }
@media (prefers-color-scheme: dark) {
  body { background: #0b0e17; color: #e2e8f0; }
  .demo-card { background: #10141f; border-color: #202a44; }
  .demo-note { color: #94a3b8; }
  code { background: #1e2740; color: #cbd5e1; }
}
`;

async function main(): Promise<void> {
  const result = await build({
    entryPoints: [ENTRY],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["es2022"],
    jsx: "automatic",
    minify: true,
    write: false,
    plugins: [tsResolve],
    logLevel: "warning",
  });
  const output = result.outputFiles[0];
  if (output === undefined) throw new BuildError({ detail: "esbuild produced no output" });
  const html = renderHtml(output.text);
  mkdirSync(dirname(OUT_FILE), { recursive: true });
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
