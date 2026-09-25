// Builds dist/deploy-page.html: the page nginx serves while a production
// deploy has the hub stopped (deploy/nginx/beebox.conf).
//
// The output is a template. On the server, deploy/server-bin/bbx-deploy-window
// replaces the three placeholders with digits and a UTC time, then writes the
// result where nginx looks for it. Everything else is fixed here, including
// the bundled client (src/frontend/src/deploy-page/deploy-page.ts): nginx
// serves one self-contained file, with the hub (and every asset it serves)
// down.
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const PLACEHOLDERS = {
  startedMs: "__BBX_STARTED_MS__",
  startedUtc: "__BBX_STARTED_UTC__",
  typicalSeconds: "__BBX_TYPICAL_SECONDS__",
} as const;

const root = join(import.meta.dirname, "..");

class DeployPageBundleError extends Error {
  constructor(outputCount: number) {
    super(`deploy page: expected exactly one bundle output, got ${outputCount}`);
    this.name = "DeployPageBundleError";
  }
}

export async function renderDeployPageTemplate(): Promise<string> {
  const bundle = await build({
    entryPoints: [join(root, "src/frontend/src/deploy-page/deploy-page.ts")],
    tsconfig: join(root, "src/frontend/tsconfig.json"),
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2020",
    minify: true,
    logLevel: "warning",
  });
  const [output] = bundle.outputFiles;
  if (!output || bundle.outputFiles.length !== 1) throw new DeployPageBundleError(bundle.outputFiles.length);
  // The script sits inline in the HTML, so a literal "</script" inside it would
  // end the element early.
  const script = output.text.replaceAll("</script", "<\\/script");
  const data = `{"startedMs":${PLACEHOLDERS.startedMs},"typicalSeconds":${PLACEHOLDERS.typicalSeconds}}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Updating</title>
<noscript><meta http-equiv="refresh" content="30"></noscript>
<style>
:root { color-scheme: light dark; --bg: #f7f6f2; --fg: #1f1e1b; --muted: #5f5c55; }
@media (prefers-color-scheme: dark) { :root { --bg: #1b1a18; --fg: #ecebe6; --muted: #a8a59c; } }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg);
  font: 17px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 32rem; padding: 2rem 1rem; }
h1 { font-size: 1.4rem; margin: 0 0 0.5rem; }
p { margin: 0; color: var(--muted); }
</style>
</head>
<body>
<main>
<h1 id="bbx-headline">This site is updating</h1>
<p id="bbx-detail">The update started at ${PLACEHOLDERS.startedUtc}. This page reloads every 30 seconds.</p>
</main>
<script type="application/json" id="bbx-deploy">${data}</script>
<script>${script}</script>
</body>
</html>
`;
}

if (import.meta.main) {
  const distDir = join(root, "dist");
  await mkdir(distDir, { recursive: true });
  await writeFile(join(distDir, "deploy-page.html"), await renderDeployPageTemplate());
}
