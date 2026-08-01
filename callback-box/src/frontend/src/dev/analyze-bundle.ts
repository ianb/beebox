/**
 * Repeatable production bundle composition analysis.
 *
 * Runs a real `vite build` with the bundle-analysis plugin
 * (bundle-analysis-plugin.ts) enabled via CB_ANALYZE_BUNDLE=1, then reads
 * the JSON report it wrote and prints a formatted summary: initial vs.
 * async chunk sizes (raw + gzip), and per-package byte attribution.
 *
 * `pnpm analyze:bundle` — no other output on success (the build's own
 * stdout/stderr is captured and only shown if the build fails).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import { formatBundleReport } from "./bundle-analysis-format";
import { BUNDLE_REPORT_RELATIVE_PATH, FRONTEND_OUT_DIR, type BundleReport } from "./bundle-analysis-types";

// This file lives at src/frontend/src/dev/ — two levels below the frontend
// package root (which is also Vite's `root`, and where `build.outDir` in
// vite.config.ts resolves FRONTEND_OUT_DIR from).
const FRONTEND_ROOT = resolvePath(import.meta.dirname, "../..");
const REPORT_PATH = resolvePath(FRONTEND_ROOT, FRONTEND_OUT_DIR, BUNDLE_REPORT_RELATIVE_PATH);
const TOP_PACKAGES = 25;

function runAnalysisBuild(): void {
  const viteBin = resolvePath(FRONTEND_ROOT, "node_modules/.bin/vite");
  try {
    execFileSync(viteBin, ["build"], {
      cwd: FRONTEND_ROOT,
      env: { ...process.env, CB_ANALYZE_BUNDLE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const stdout = e instanceof Error && "stdout" in e ? String(e.stdout) : "";
    const stderr = e instanceof Error && "stderr" in e ? String(e.stderr) : "";
    process.stderr.write(`analyze:bundle — vite build failed:\n${stdout}\n${stderr}\n`);
    throw e;
  }
}

// Disk boundary (code-style.md "Defensiveness" #1): the report JSON comes
// back off disk from a separate vite process, so it gets schema-validated,
// not cast. `satisfies` keeps the schema and the BundleReport interface from
// drifting: a field added to the interface without a schema line fails here.
const moduleAttributionSchema = z.object({
  package: z.string(),
  rawBytes: z.number(),
  gzipBytes: z.number(),
});
const bundleReportSchema = z.object({
  generatedAt: z.string(),
  chunks: z.array(
    z.object({
      fileName: z.string(),
      isEntry: z.boolean(),
      isDynamicEntry: z.boolean(),
      isInitial: z.boolean(),
      rawBytes: z.number(),
      gzipBytes: z.number(),
      imports: z.array(z.string()),
      dynamicImports: z.array(z.string()),
      modules: z.array(moduleAttributionSchema),
    }),
  ),
  assets: z.array(
    z.object({
      fileName: z.string(),
      isInitial: z.boolean(),
      rawBytes: z.number(),
      gzipBytes: z.number(),
    }),
  ),
  packages: z.array(
    z.object({
      package: z.string(),
      rawBytes: z.number(),
      gzipBytes: z.number(),
      initialRawBytes: z.number(),
      initialGzipBytes: z.number(),
      chunkFileNames: z.array(z.string()),
    }),
  ),
  totals: z.object({
    initialJsRawBytes: z.number(),
    initialJsGzipBytes: z.number(),
    initialCssRawBytes: z.number(),
    initialCssGzipBytes: z.number(),
    asyncJsRawBytes: z.number(),
    asyncJsGzipBytes: z.number(),
  }),
});

/** The on-disk report JSON failed schema validation — the plugin and CLI
 * shapes have drifted, or the file is stale/corrupt. */
class BundleReportShapeError extends Error {
  constructor(args: { reportPath: string; cause: z.ZodError }) {
    super(`bundle report JSON does not match the expected report shape (${args.reportPath}): ${args.cause.message}`, {
      cause: args.cause,
    });
    this.name = "BundleReportShapeError";
  }
}

function readReport(): BundleReport {
  const raw = readFileSync(REPORT_PATH, "utf8");
  const parsed = bundleReportSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new BundleReportShapeError({ reportPath: REPORT_PATH, cause: parsed.error });
  }
  return parsed.data satisfies BundleReport;
}

runAnalysisBuild();
const report = readReport();
process.stdout.write(`${formatBundleReport(report, { topPackages: TOP_PACKAGES })}\n`);
