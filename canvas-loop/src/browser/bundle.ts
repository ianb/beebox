// Bundling browser code into one self-contained HTML page: esbuild bundles an
// entry to an ES module (the scene code reads import.meta.url, so a module
// script), and `htmlPage` wraps it with inline CSS. The playground build
// (build.ts) and the live page (`cli page`, page-build.ts) share it.
import { build } from "esbuild";
import type { OnResolveArgs, Plugin } from "esbuild";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// The repo writes NodeNext `.js` import specifiers that point at `.ts` sources;
// esbuild resolves real files, so remap each relative `.js` to its `.ts`.
const tsResolve: Plugin = {
  name: "ts-from-js-specifier",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /\.js$/ }, (args: OnResolveArgs) => {
      if (!args.path.startsWith(".")) return null;
      const tsPath = resolve(args.resolveDir, args.path).replace(/\.js$/u, ".ts");
      return existsSync(tsPath) ? { path: tsPath } : null;
    });
  },
};

/** The entry and everything it imports, as one minified ES module. */
export async function bundleEntry(entry: string): Promise<string> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    minify: true,
    write: false,
    plugins: [tsResolve],
    logLevel: "warning",
  });
  const output = result.outputFiles[0];
  if (output === undefined) throw new BundleError({ detail: `esbuild produced no output for ${entry}` });
  return output.text;
}

/** One HTML document holding `css` and the bundled `js` inline. */
export function htmlPage(page: { title: string; css: string; js: string }): string {
  // Neutralise any `</script>` that could close the inline block early.
  const safe = page.js.replace(/<\/script>/giu, "<\\/script>");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${page.title.replace(/[<&]/gu, (c) => (c === "<" ? "&lt;" : "&amp;"))}</title>
<style>${page.css}</style>
</head>
<body>
<div id="app"></div>
<script type="module">${safe}</script>
</body>
</html>
`;
}

export class BundleError extends Error {
  name = "BundleError";
  constructor(options: { detail: string }) {
    super(`bundle: ${options.detail}`);
  }
}
