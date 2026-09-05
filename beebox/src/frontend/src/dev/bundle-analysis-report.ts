/**
 * Pure computation over a Rollup `OutputBundle` (Vite's `generateBundle`
 * hook argument) into a `BundleReport`. No filesystem or Vite-plugin
 * wiring here — that's `bundle-analysis-plugin.ts` — so this half is
 * trivial to reason about and could be unit-tested directly against a
 * hand-built bundle fixture.
 */

import { gzipSync } from "node:zlib";
import type { OutputAsset, OutputBundle, OutputChunk } from "rollup";
import type {
  BundleAssetReport,
  BundleChunkReport,
  BundleModuleAttribution,
  BundlePackageTotal,
  BundleReport,
} from "./bundle-analysis-types";

const NODE_MODULES_MARKER = "/node_modules/";

/**
 * Attribute a Rollup module id to the npm package (or app-source bucket)
 * that owns it. Handles pnpm's nested `.pnpm/<pkg>@<ver>/node_modules/<pkg>`
 * layout by keying off the LAST `node_modules` segment, and the one
 * workspace package (`@ianbicking/canvas-loop`) that resolves outside
 * `node_modules` entirely because it's symlink-realpath'd to its source
 * checkout (see vite.config.ts `optimizeDeps.exclude`).
 */
function packageNameForModuleId(id: string, frontendRoot: string): string {
  const normalized = id.replace(/\\/g, "/");
  const lastNodeModules = normalized.lastIndexOf(NODE_MODULES_MARKER);
  if (lastNodeModules !== -1) {
    const afterNodeModules = normalized.slice(lastNodeModules + NODE_MODULES_MARKER.length);
    const segments = afterNodeModules.split("/");
    const first = segments[0];
    if (first === undefined) return "other";
    if (first.startsWith("@") && segments[1] !== undefined) return `${first}/${segments[1]}`;
    return first;
  }
  if (normalized.includes("/canvas-loop/")) return "@ianbicking/canvas-loop";
  const srcPrefix = `${frontendRoot}/src/`;
  if (normalized.startsWith(srcPrefix)) {
    const relative = normalized.slice(srcPrefix.length);
    const topDir = relative.split("/")[0];
    return `app:${topDir ?? relative}`;
  }
  if (normalized.startsWith("\0")) return "runtime:rollup-virtual";
  return "other";
}

function gzipLength(code: string): number {
  return gzipSync(Buffer.from(code, "utf8")).length;
}

function isOutputChunk(item: OutputAsset | OutputChunk): item is OutputChunk {
  return item.type === "chunk";
}

/** Vite augments Rollup's `OutputChunk` with `viteMetadata` at runtime
 * (which CSS/asset files a chunk pulled in) — not part of Vite 5's public
 * `.d.ts` (checked node_modules/vite/dist/node/index.d.ts, which re-exports
 * Rollup's `OutputChunk` unmodified), so this narrows the real runtime
 * shape rather than working around an actual type gap. */
interface ViteChunkMetadata {
  importedCss: Set<string>;
}
function importedCssFileNames(chunk: OutputChunk): Set<string> {
  // eslint-disable-next-line no-restricted-syntax -- vite-internal runtime field absent from vite 5's public .d.ts (verified 2026-08-01)
  const withMetadata = chunk as OutputChunk & { viteMetadata?: ViteChunkMetadata };
  return withMetadata.viteMetadata?.importedCss ?? new Set<string>();
}

/** BFS from every entry chunk over STATIC `imports` only (never
 * `dynamicImports`) — the set of chunks a fresh page load must fetch before
 * the app can run. */
function computeInitialChunkFileNames(chunksByFileName: Map<string, OutputChunk>): Set<string> {
  const initial = new Set<string>();
  const queue: string[] = [...chunksByFileName.values()]
    .filter((chunk) => chunk.isEntry)
    .map((chunk) => chunk.fileName);
  while (queue.length > 0) {
    const fileName = queue.pop();
    if (fileName === undefined || initial.has(fileName)) continue;
    initial.add(fileName);
    const chunk = chunksByFileName.get(fileName);
    if (chunk === undefined) continue;
    for (const importedFileName of chunk.imports) {
      if (!initial.has(importedFileName)) queue.push(importedFileName);
    }
  }
  return initial;
}

/**
 * Rollup's per-module `renderedLength`/module-`code` reflect Rollup's own
 * tree-shaken output BEFORE the minifier's `renderChunk` pass runs — only
 * the final `chunk.code` (used for `rawBytes`/`gzipBytes` above) has gone
 * through minification. Summed pre-minification module weights can
 * therefore overshoot the chunk's real, shipped size by 2-3x (verified:
 * p5's modules alone summed to 3.0 MB inside a 1.0 MB actual chunk).
 * Minification compacts every module roughly proportionally (identifier
 * shortening, whitespace removal), so scaling each module's weight by
 * `actualChunkBytes / totalWeight` keeps relative ranking meaningful while
 * making the per-chunk sum exactly match the chunk's real, additive size —
 * an estimate, not a byte-exact attribution (that needs source-map-based
 * mapping, which this tool doesn't do).
 */
function scaleToActual(params: {
  weights: Map<string, number>;
  actualBytes: number;
}): Map<string, number> {
  const { weights, actualBytes } = params;
  const totalWeight = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  if (totalWeight === 0) return weights;
  const scale = actualBytes / totalWeight;
  return new Map([...weights].map(([packageName, weight]) => [packageName, Math.round(weight * scale)]));
}

function buildChunkReport(params: {
  chunk: OutputChunk;
  isInitial: boolean;
  frontendRoot: string;
}): BundleChunkReport {
  const { chunk, isInitial, frontendRoot } = params;
  const rawWeights = new Map<string, number>();
  const gzipWeights = new Map<string, number>();
  for (const [moduleId, mod] of Object.entries(chunk.modules)) {
    const packageName = packageNameForModuleId(moduleId, frontendRoot);
    rawWeights.set(packageName, (rawWeights.get(packageName) ?? 0) + mod.renderedLength);
    const gzipWeight = mod.code === null ? 0 : gzipLength(mod.code);
    gzipWeights.set(packageName, (gzipWeights.get(packageName) ?? 0) + gzipWeight);
  }
  const rawBytes = Buffer.byteLength(chunk.code, "utf8");
  const gzipBytes = gzipLength(chunk.code);
  const scaledRaw = scaleToActual({ weights: rawWeights, actualBytes: rawBytes });
  const scaledGzip = scaleToActual({ weights: gzipWeights, actualBytes: gzipBytes });
  const modules: BundleModuleAttribution[] = [...rawWeights.keys()].map((packageName) => ({
    package: packageName,
    rawBytes: scaledRaw.get(packageName) ?? 0,
    gzipBytes: scaledGzip.get(packageName) ?? 0,
  }));
  return {
    fileName: chunk.fileName,
    isEntry: chunk.isEntry,
    isDynamicEntry: chunk.isDynamicEntry,
    isInitial,
    rawBytes,
    gzipBytes,
    imports: chunk.imports,
    dynamicImports: chunk.dynamicImports,
    modules: modules.toSorted((a, b) => b.rawBytes - a.rawBytes),
  };
}

function buildAssetReport(params: {
  asset: OutputAsset;
  isInitial: boolean;
}): BundleAssetReport {
  const { asset, isInitial } = params;
  const source = typeof asset.source === "string" ? Buffer.from(asset.source, "utf8") : Buffer.from(asset.source);
  return {
    fileName: asset.fileName,
    isInitial,
    rawBytes: source.byteLength,
    gzipBytes: gzipSync(source).length,
  };
}

function aggregatePackages(chunks: BundleChunkReport[]): BundlePackageTotal[] {
  const totals = new Map<string, BundlePackageTotal>();
  for (const chunk of chunks) {
    for (const mod of chunk.modules) {
      const existing = totals.get(mod.package);
      if (existing === undefined) {
        totals.set(mod.package, {
          package: mod.package,
          rawBytes: mod.rawBytes,
          gzipBytes: mod.gzipBytes,
          initialRawBytes: chunk.isInitial ? mod.rawBytes : 0,
          initialGzipBytes: chunk.isInitial ? mod.gzipBytes : 0,
          chunkFileNames: [chunk.fileName],
        });
        continue;
      }
      existing.rawBytes += mod.rawBytes;
      existing.gzipBytes += mod.gzipBytes;
      if (chunk.isInitial) {
        existing.initialRawBytes += mod.rawBytes;
        existing.initialGzipBytes += mod.gzipBytes;
      }
      existing.chunkFileNames.push(chunk.fileName);
    }
  }
  return [...totals.values()].toSorted((a, b) => b.rawBytes - a.rawBytes);
}

export function buildBundleReport(params: {
  bundle: OutputBundle;
  frontendRoot: string;
}): BundleReport {
  const { bundle, frontendRoot } = params;
  const items = Object.values(bundle);
  const outputChunks = items.filter(isOutputChunk);
  const chunksByFileName = new Map(outputChunks.map((chunk) => [chunk.fileName, chunk]));
  const initialChunkFileNames = computeInitialChunkFileNames(chunksByFileName);

  const initialCssFileNames = new Set<string>();
  for (const fileName of initialChunkFileNames) {
    const chunk = chunksByFileName.get(fileName);
    if (chunk === undefined) continue;
    for (const cssFileName of importedCssFileNames(chunk)) initialCssFileNames.add(cssFileName);
  }

  const chunks = outputChunks.map((chunk) =>
    buildChunkReport({ chunk, isInitial: initialChunkFileNames.has(chunk.fileName), frontendRoot }),
  );
  const assets = items
    .filter((item): item is OutputAsset => item.type === "asset")
    .map((asset) => buildAssetReport({ asset, isInitial: initialCssFileNames.has(asset.fileName) }));

  const totals = {
    initialJsRawBytes: chunks.filter((c) => c.isInitial).reduce((sum, c) => sum + c.rawBytes, 0),
    initialJsGzipBytes: chunks.filter((c) => c.isInitial).reduce((sum, c) => sum + c.gzipBytes, 0),
    initialCssRawBytes: assets.filter((a) => a.isInitial).reduce((sum, a) => sum + a.rawBytes, 0),
    initialCssGzipBytes: assets.filter((a) => a.isInitial).reduce((sum, a) => sum + a.gzipBytes, 0),
    asyncJsRawBytes: chunks.filter((c) => !c.isInitial).reduce((sum, c) => sum + c.rawBytes, 0),
    asyncJsGzipBytes: chunks.filter((c) => !c.isInitial).reduce((sum, c) => sum + c.gzipBytes, 0),
  };

  return {
    generatedAt: new Date().toISOString(),
    chunks: chunks.toSorted((a, b) => b.rawBytes - a.rawBytes),
    assets: assets.toSorted((a, b) => b.rawBytes - a.rawBytes),
    packages: aggregatePackages(chunks),
    totals,
  };
}
