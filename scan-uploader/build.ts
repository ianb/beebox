/** Bundles the CLI into a single self-contained `dist/scan-uploader.mjs`,
 * runnable with plain `node` on any machine — no checkout, no install. */

import { chmod } from "node:fs/promises";
import { build } from "esbuild";
import { buildStampJson } from "./src/build-revision.js";

await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/scan-uploader.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
  // Baked in rather than read at runtime: a copied bundle has no git tree and
  // no package.json to ask, and it is the one artifact here that can silently
  // fall behind, so the build is the only moment its identity can be captured.
  define: { __UPLOADER_BUILD__: JSON.stringify(await buildStampJson()) },
});

// The bundle doubles as the package's `bin` entry — make it executable so
// `pnpm exec scan-uploader` works on a checkout (the copy-the-file story
// still runs it via plain `node`).
await chmod("dist/scan-uploader.mjs", 0o755);
