/**
 * Shared shape for the production bundle composition report.
 *
 * `bundle-analysis-plugin.ts` (a Vite plugin) produces this from a real
 * `vite build` and writes it as JSON; `analyze-bundle.ts` reads that JSON
 * back and formats it for a terminal. Splitting the shape out keeps the two
 * sides (Rollup-facing producer, terminal-facing consumer) decoupled from
 * each other's implementation.
 */

/** One npm package's (or app-source bucket's) footprint within a single chunk. */
export interface BundleModuleAttribution {
  /** npm package name (scoped packages keep their `@scope/name` form), an
   * `app:<top-level src dir>` bucket for our own source, or `other`/
   * `runtime:*` for anything that doesn't fit either (Rollup's synthetic
   * helper modules, virtual ids). */
  package: string;
  /** This package's share of the chunk's REAL (post-minification) raw
   * bytes. Derived from Rollup's pre-minification `renderedLength` per
   * module, then scaled so the chunk's modules sum exactly to the chunk's
   * actual `rawBytes` (see `scaleToActual` in bundle-analysis-report.ts) —
   * an estimate of proportional contribution, not a byte-exact mapping. */
  rawBytes: number;
  /** Same idea for gzip: independently gzipped per-module code, scaled so
   * the chunk's modules sum to the chunk's actual (additive) `gzipBytes`. */
  gzipBytes: number;
}

export interface BundleChunkReport {
  fileName: string;
  /** Rollup's own flag: this chunk backs a static `<script>` entry point. */
  isEntry: boolean;
  /** Rollup's own flag: this chunk is the target of at least one `import()`. */
  isDynamicEntry: boolean;
  /** Computed here: reachable from an entry chunk via static `imports` only
   * (never `dynamicImports`) — i.e. downloaded before the app can run. */
  isInitial: boolean;
  rawBytes: number;
  /** Gzip of the whole chunk's emitted code — the real, additive number. */
  gzipBytes: number;
  /** Other chunks this one statically imports (loads eagerly alongside it). */
  imports: string[];
  /** Other chunks this one only reaches via `import()` (lazy). */
  dynamicImports: string[];
  modules: BundleModuleAttribution[];
}

export interface BundleAssetReport {
  fileName: string;
  /** True when at least one initial chunk pulls this asset in (Vite's
   * `viteMetadata.importedCss`) — only meaningful for CSS today. */
  isInitial: boolean;
  rawBytes: number;
  gzipBytes: number;
}

export interface BundlePackageTotal {
  package: string;
  rawBytes: number;
  gzipBytes: number;
  /** Portion of the above that lives in an initial (non-lazy) chunk. */
  initialRawBytes: number;
  initialGzipBytes: number;
  chunkFileNames: string[];
}

export interface BundleReportTotals {
  initialJsRawBytes: number;
  initialJsGzipBytes: number;
  initialCssRawBytes: number;
  initialCssGzipBytes: number;
  asyncJsRawBytes: number;
  asyncJsGzipBytes: number;
}

export interface BundleReport {
  generatedAt: string;
  chunks: BundleChunkReport[];
  assets: BundleAssetReport[];
  packages: BundlePackageTotal[];
  totals: BundleReportTotals;
}

/** Path the plugin writes to and the CLI reads from, relative to Vite's
 * `build.outDir`. Kept as one constant so the two sides can't drift. */
export const BUNDLE_REPORT_RELATIVE_PATH = "analysis/bundle-report.json";

/** The frontend's `build.outDir`. vite.config.ts and analyze-bundle.ts both
 * read this constant, so a future outDir change can't silently strand the
 * CLI reading a stale path (the plugin itself always uses Vite's resolved
 * value and only defaults to this). */
export const FRONTEND_OUT_DIR = "dist";
