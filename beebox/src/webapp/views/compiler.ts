/**
 * Server-side compiler for agent-generated view .tsx files.
 *
 * Uses esbuild to bundle each view into an ES module with React
 * externalized via a shim that delegates to window.__bbxReact.
 * Caches compiled output keyed by file mtime.
 */

import * as esbuild from "esbuild";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { glob } from "glob";
import type { ViewMeta } from "../../core/views/types.js";
import { getBoxShape, boxCodePaths, type BoxShape } from "../../lib/box-shape.js";
import { importViewMetadata } from "./view-meta-import.js";
import { boxPackageHost, type ViewHostContext } from "./node-view-runtime.js";

/**
 * Where the compiled view will run:
 * - "browser" (default) — React externalized to the `window.__bbxReact` shim, as
 *   the running app's frontend dynamically imports it.
 * - "node" — React externalized to the bare `react`/`react/jsx-runtime`
 *   specifiers so a Node renderer (`bbx view test`) resolves the real React from
 *   node_modules and shares one instance with `react-dom/server`. Emits an inline
 *   source map and a box-relative source name so render-time stack traces map
 *   back to the `.tsx`.
 */
export type ViewCompileTarget = "browser" | "node";

interface CacheEntry {
  mtime: number;
  // File size joins mtime in the freshness check: an editor that rewrites a file
  // within the same clock tick leaves mtimeMs unchanged, so mtime alone would
  // serve stale output (including a stale figureError after the fix that cleared
  // it). Size is a free stat field and catches most same-tick length-changing
  // edits.
  size: number;
  output: string;
}

/** Cached metadata, keyed by the view file's own path, invalidated by a
 * content hash rather than mtime — a touch that doesn't change the source
 * (e.g. a git checkout) shouldn't force a re-import. */
interface MetaCacheEntry {
  hash: string;
  meta: Omit<ViewMeta, "lastModified">;
}

class EmptyEsbuildOutputError extends Error {
  readonly viewPath: string;
  constructor(viewPath: string) {
    super(`esbuild produced no output for ${viewPath}`);
    this.name = "EmptyEsbuildOutputError";
    this.viewPath = viewPath;
  }
}

const cache = new Map<string, CacheEntry>();
const metaCache = new Map<string, MetaCacheEntry>();

const reactExternalPlugin: esbuild.Plugin = {
  name: "react-external",
  setup(build) {
    build.onResolve({ filter: /^react(\/.*)?$/ }, (args) => ({
      path: args.path,
      namespace: "react-shim",
    }));
    build.onLoad({ filter: /.*/, namespace: "react-shim" }, (args) => {
      if (args.path === "react/jsx-runtime" || args.path === "react/jsx-dev-runtime") {
        // Translate the automatic-runtime calling convention to createElement:
        // jsx/jsxs/jsxDEV pass children *inside* props and `key` as a separate
        // arg, while createElement reads children from its rest params and `key`
        // from config. Aliasing them directly (the old shim) passed a static
        // children array as a single child — triggering React's spurious
        // "unique key" dev warning for every multi-child view — and dropped
        // `key`. Spreading the children array as positional args restores both.
        return {
          contents: `const React = window.__bbxReact;
function jsx(type, props, key) {
  const { children, ...rest } = props;
  if (key !== undefined) rest.key = key;
  if (children === undefined) return React.createElement(type, rest);
  return Array.isArray(children)
    ? React.createElement(type, rest, ...children)
    : React.createElement(type, rest, children);
}
export { jsx };
export const jsxs = jsx;
export const jsxDEV = jsx;
export const Fragment = React.Fragment;`,
          loader: "js",
        };
      }
      return {
        contents: `const React = window.__bbxReact;
export default React;
export const { useState, useEffect, useMemo, useCallback, useRef, useContext, useReducer, memo, forwardRef, createContext, createElement, Fragment, lazy, Suspense } = React;`,
        loader: "js",
      };
    });
  },
};

/**
 * Browser shim for the public `beebox/view-widgets` specifier: resolve it
 * to the host's `window.__bbxViewWidgets` registry, mirroring the React shim.
 * The host (ViewRenderer) installs that global before any view loads. Node
 * builds externalize the bare specifier instead (resolved via the package
 * `exports` map — see compileView and `bbx view test`).
 */
const viewWidgetsExternalPlugin: esbuild.Plugin = {
  name: "view-widgets-external",
  setup(build) {
    build.onResolve({ filter: /^beebox\/view-widgets$/ }, (args) => ({
      path: args.path,
      namespace: "view-widgets-shim",
    }));
    build.onLoad({ filter: /.*/, namespace: "view-widgets-shim" }, () => ({
      contents: `const W = window.__bbxViewWidgets;
export const CardLink = W.CardLink;
export const CardRef = W.CardRef;`,
      loader: "js",
    }));
  },
};

function slugFromFilename(filename: string): string {
  return path.basename(filename, ".tsx");
}

/**
 * Bundle a single view file with esbuild. Returns the compiled output or
 * throws — no metadata involved, so callers that only need JS (serving
 * `module.js`, the edit-time lint check, a figure sketch) don't pay for a
 * metadata import they don't use. `target` selects React resolution (browser
 * shim vs bare Node specifiers) — see {@link ViewCompileTarget}; defaults to
 * "browser".
 */
export async function bundleView(
  viewPath: string,
  opts?: { target?: ViewCompileTarget; external?: string[]; cache?: boolean }
): Promise<{ output: string }> {
  const target = opts?.target ?? "browser";
  // The mtime+size cache is a freshness heuristic, not a guarantee: it misses a
  // same-length rewrite within one clock tick, and — because `bundle: true`
  // inlines imports — it never notices an edited *imported* file (the key is the
  // entry's stat only). Callers that must always reflect current disk state pass
  // `cache: false`; a tiny single-file compile (a figure sketch) is cheap enough
  // to redo per request, and it's strictly correct.
  const useCache = opts?.cache ?? true;
  // Extra bare specifiers to leave unbundled. Figure sketches receive their
  // runtime library (p5/three/d3) as an argument from the harness; marking
  // those external means a stray `import p5` fails loudly at load instead of
  // esbuild trying (and failing) to resolve it from the attach dir.
  const extraExternal = opts?.external ?? [];
  const stat = await fs.stat(viewPath);
  const mtime = stat.mtimeMs;
  const size = stat.size;

  // Key the cache by target too: the browser and node builds of the same file
  // produce incompatible output (window shim vs bare imports), so sharing one
  // slot would let one target's compile poison the other's. Externals go in the
  // key as well, so the same file compiled with and without them never collides.
  // The viewPath is always the final `:`-delimited segment — invalidateView
  // relies on that to sweep every key referencing a path.
  const cacheKey = `${target}:${extraExternal.join(",")}:${viewPath}`;
  if (useCache) {
    const cached = cache.get(cacheKey);
    if (cached && cached.mtime === mtime && cached.size === size) {
      return { output: cached.output };
    }
  }

  const source = await fs.readFile(viewPath, "utf-8");

  // Node target: externalize React to bare specifiers and emit an inline source
  // map named by the box-relative path (views/<slug>.tsx), so a render-time
  // throw maps to the real source line. Browser target: the window-shim plugin.
  const reactConfig: Pick<esbuild.BuildOptions, "plugins" | "external" | "sourcemap"> =
    target === "node"
      ? {
          external: [
            "react",
            "react/jsx-runtime",
            "react/jsx-dev-runtime",
            // Resolved from a real box package's node_modules (box-package host)
            // or the engine's own (engine-hosted, via a temp symlink) — see
            // node-view-runtime.ts.
            "beebox/view-widgets",
            ...extraExternal,
          ],
          sourcemap: "inline",
        }
      : { plugins: [reactExternalPlugin, viewWidgetsExternalPlugin], external: extraExternal };
  const sourcefile = target === "node" ? path.join("views", path.basename(viewPath)) : path.basename(viewPath);

  const result = await esbuild.build({
    stdin: {
      contents: source,
      loader: "tsx",
      resolveDir: path.dirname(viewPath),
      sourcefile,
    },
    bundle: true,
    format: "esm",
    target: "es2020",
    jsx: "automatic",
    write: false,
    ...reactConfig,
    // Surfacing compile errors is the caller's job (the route returns an
    // ErrorView module; the CLI prints the message); esbuild's own stderr
    // printout is redundant noise here.
    logLevel: "silent",
  });

  const outputFile = result.outputFiles[0];
  if (!outputFile) {
    throw new EmptyEsbuildOutputError(viewPath);
  }
  const output = outputFile.text;
  if (useCache) cache.set(cacheKey, { mtime, size, output });
  return { output };
}

/**
 * Get a view's metadata: name, description, dependencies, modes,
 * rendersCardTypes. Compiles the view for the node target and imports the
 * real module in a subprocess (see `view-meta-import.ts`) rather than
 * regexing source text, so metadata reflects what the view actually exports
 * (computed values, not just string literals). Cached by a hash of the
 * view's source content, so repeated calls (e.g. `listViews` on every
 * `views.list` tRPC request) don't recompile/reimport an unchanged view.
 *
 * Never throws: a view that fails to compile or import degrades to a
 * filename + "Failed to compile" marker (see `listViews`) rather than
 * vanishing from the listing.
 */
export async function getViewMeta(viewPath: string, opts?: { viewHost?: ViewHostContext }): Promise<ViewMeta> {
  // No host given means no box package hosts this compile — the engine does.
  const viewHost: ViewHostContext = opts?.viewHost ?? { kind: "engine-hosted" };
  const slug = slugFromFilename(viewPath);
  const fallback: Omit<ViewMeta, "lastModified"> = {
    name: slug,
    slug,
    description: "Failed to compile",
    dependencies: [],
    modes: ["page"],
    rendersCardTypes: [],
  };

  let mtimeIso: string;
  let source: string;
  try {
    const stat = await fs.stat(viewPath);
    mtimeIso = stat.mtime.toISOString();
    source = await fs.readFile(viewPath, "utf-8");
  } catch (_e) {
    // The file vanished (a race with glob/delete) or was never readable —
    // nothing to hash or compile; degrade without touching the cache.
    return { ...fallback, lastModified: new Date().toISOString() };
  }

  const hash = createHash("sha256").update(source).digest("hex");
  const cached = metaCache.get(viewPath);
  if (cached && cached.hash === hash) {
    return { ...cached.meta, lastModified: mtimeIso };
  }

  let meta: Omit<ViewMeta, "lastModified">;
  try {
    const { output } = await bundleView(viewPath, { target: "node" });
    const imported = await importViewMetadata(output, viewHost);
    meta = imported
      ? {
          name: imported.name ?? slug,
          slug,
          description: imported.description ?? "",
          dependencies: imported.dependencies ?? [],
          modes: imported.modes ?? ["page"],
          rendersCardTypes: imported.rendersCardTypes ?? [],
        }
      : fallback;
  } catch (_e) {
    // Compiling for the node target failed (e.g. a syntax error) — same
    // degrade-to-marker fallback as an import failure.
    meta = fallback;
  }

  metaCache.set(viewPath, { hash, meta });
  return { ...meta, lastModified: mtimeIso };
}

/**
 * Compile a single view file for serving/rendering and get its metadata.
 * Returns { output, meta } or throws if bundling for `target` fails —
 * callers that only need metadata (not the bundled output) should call
 * {@link getViewMeta} directly instead, which never throws.
 */
export async function compileView(
  viewPath: string,
  opts?: { target?: ViewCompileTarget; external?: string[]; viewHost?: ViewHostContext }
): Promise<{ output: string; meta: ViewMeta }> {
  const bundleOpts: { target?: ViewCompileTarget; external?: string[] } = {};
  if (opts?.target !== undefined) bundleOpts.target = opts.target;
  if (opts?.external !== undefined) bundleOpts.external = opts.external;
  const { output } = await bundleView(viewPath, bundleOpts);

  const metaOpts: { viewHost?: ViewHostContext } = {};
  if (opts?.viewHost !== undefined) metaOpts.viewHost = opts.viewHost;
  const meta = await getViewMeta(viewPath, metaOpts);

  return { output, meta };
}

/**
 * Edit-time compile check for the validation hooks: returns null if the view
 * compiles, or a human-readable error message otherwise. Compile only — no
 * execution, no type-check (the deeper signal is `bbx view test`), and no
 * metadata import (a syntax-checking hook shouldn't pay for a subprocess
 * import). Shared by the shell `bbx validate --hook` and the in-process
 * `cardValidatorHook` so both surface the same error. Uses the default
 * browser target — the exact compile the running app does.
 */
export async function lintViewFile(viewPath: string): Promise<string | null> {
  try {
    await bundleView(viewPath);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * Build an error module that exports an error component.
 */
export function buildErrorModule(message: string): string {
  const escaped = message.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
  return `export default function ErrorView() {
  return window.__bbxReact.createElement("pre", {style:{color:"red",whiteSpace:"pre-wrap",padding:"1rem"}}, \`${escaped}\`);
}
export const name = "Error";
export const description = "Failed to compile";
export const dependencies = [];
export const modes = ["page", "chat"];
`;
}

/**
 * Resolve a box's views directory for its shape: `boxRoot/src/views`.
 * Delegates to `boxCodePaths`, the one place that predicate is defined
 * (`src/lib/box-shape.ts`).
 */
export async function resolveViewsDir(boxRoot: string): Promise<{ viewsDir: string; boxShape: BoxShape }> {
  const boxShape = await getBoxShape(boxRoot);
  return { viewsDir: boxCodePaths(boxShape).viewsDir, boxShape };
}

/**
 * List all views in a box, resolving the views directory from the box's
 * shape (`boxRoot/src/views`).
 *
 * A view that fails to compile or fails to import (including a subprocess
 * timeout — see `view-meta-import.ts`) still appears here, degraded to a
 * filename + "Failed to compile" marker (via `getViewMeta`, which never
 * throws) — never silently vanishes from the listing.
 */
export async function listViews(boxRoot: string): Promise<ViewMeta[]> {
  const { viewsDir, boxShape } = await resolveViewsDir(boxRoot);
  try {
    await fs.access(viewsDir);
  } catch (_e) {
    // fs.access throwing means the box has no views dir — a box with no
    // views is normal, so return an empty list. The error carries no
    // actionable info beyond "directory absent".
    return [];
  }

  const viewHost = boxPackageHost(boxShape);
  const files = await glob("*.tsx", { cwd: viewsDir });
  const metas: ViewMeta[] = [];
  for (const file of files) {
    const viewPath = path.join(viewsDir, file);
    metas.push(await getViewMeta(viewPath, { viewHost }));
  }
  return metas;
}

/**
 * Invalidate cache for a specific view file (every compile target AND every
 * externals combination — the figure route keys on `browser:p5,three,d3:<path>`,
 * which a fixed `browser::`/`node::` pair would miss) plus its metadata. The
 * viewPath is always the final `:`-delimited segment of a compile key, so sweep
 * every key ending in `:<viewPath>` rather than enumerating known prefixes.
 */
export function invalidateView(viewPath: string): void {
  const suffix = `:${viewPath}`;
  for (const key of cache.keys()) {
    if (key.endsWith(suffix)) cache.delete(key);
  }
  metaCache.delete(viewPath);
}
