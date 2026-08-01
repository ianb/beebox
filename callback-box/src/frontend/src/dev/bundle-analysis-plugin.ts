/**
 * Vite plugin: writes a production bundle composition report as JSON.
 *
 * Wired into vite.config.ts ONLY when CB_ANALYZE_BUNDLE=1 (set by
 * `pnpm analyze:bundle`, see analyze-bundle.ts) — zero cost on an ordinary
 * `pnpm build`. Runs in `generateBundle`, the Rollup hook that hands over
 * the full `OutputBundle` with real per-module sizes — the same accounting
 * Rollup itself used to write the files, so the numbers match the actual
 * build exactly (no separate re-parse of the emitted files).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import type { Plugin } from "vite";
import { buildBundleReport } from "./bundle-analysis-report";
import { BUNDLE_REPORT_RELATIVE_PATH } from "./bundle-analysis-types";

export function bundleAnalysisPlugin(): Plugin {
  let outDir = "dist";
  let frontendRoot = process.cwd();
  return {
    name: "cb-bundle-analysis",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
      frontendRoot = config.root;
    },
    generateBundle(_outputOptions, bundle) {
      const report = buildBundleReport({ bundle, frontendRoot });
      const outputPath = resolvePath(frontendRoot, outDir, BUNDLE_REPORT_RELATIVE_PATH);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, JSON.stringify(report, null, 2));
    },
  };
}
