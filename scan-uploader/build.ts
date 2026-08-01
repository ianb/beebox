/** Bundles the CLI into a single self-contained `dist/scan-uploader.mjs`,
 * runnable with plain `node` on any machine — no checkout, no install. */

import { build } from "esbuild";

await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/scan-uploader.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
});
