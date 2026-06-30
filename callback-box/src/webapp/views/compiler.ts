/**
 * Server-side compiler for agent-generated view .tsx files.
 *
 * Uses esbuild to bundle each view into an ES module with React
 * externalized via a shim that delegates to window.__cbReact.
 * Caches compiled output keyed by file mtime.
 */

import * as esbuild from "esbuild";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";
import type { ViewMeta, ViewMode } from "../../types/views.js";

/**
 * Where the compiled view will run:
 * - "browser" (default) — React externalized to the `window.__cbReact` shim, as
 *   the running app's frontend dynamically imports it.
 * - "node" — React externalized to the bare `react`/`react/jsx-runtime`
 *   specifiers so a Node renderer (`cb view test`) resolves the real React from
 *   node_modules and shares one instance with `react-dom/server`. Emits an inline
 *   source map and a box-relative source name so render-time stack traces map
 *   back to the `.tsx`.
 */
export type ViewCompileTarget = "browser" | "node";

interface CacheEntry {
  mtime: number;
  output: string;
  meta: ViewMeta;
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
          contents: `const React = window.__cbReact;
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
        contents: `const React = window.__cbReact;
export default React;
export const { useState, useEffect, useMemo, useCallback, useRef, useContext, useReducer, memo, forwardRef, createContext, createElement, Fragment, lazy, Suspense } = React;`,
        loader: "js",
      };
    });
  },
};

/**
 * Browser shim for the public `callback-box/view-widgets` specifier: resolve it
 * to the host's `window.__cbViewWidgets` registry, mirroring the React shim.
 * The host (ViewRenderer) installs that global before any view loads. Node
 * builds externalize the bare specifier instead (resolved via the package
 * `exports` map — see compileView and `cb view test`).
 */
const viewWidgetsExternalPlugin: esbuild.Plugin = {
  name: "view-widgets-external",
  setup(build) {
    build.onResolve({ filter: /^callback-box\/view-widgets$/ }, (args) => ({
      path: args.path,
      namespace: "view-widgets-shim",
    }));
    build.onLoad({ filter: /.*/, namespace: "view-widgets-shim" }, () => ({
      contents: `const W = window.__cbViewWidgets;
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
 * Extract metadata from view source via regex on export const declarations.
 */
function extractMeta(source: string, { slug, mtime }: { slug: string; mtime: string }): ViewMeta {
  function extractString(key: string): string {
    // eslint-disable-next-line security/detect-non-literal-regexp -- key is only ever a hardcoded metadata field name (see callers below), never user input.
    const match = source.match(new RegExp(`export\\s+const\\s+${key}\\s*=\\s*["'\`]([^"'\`]*)["'\`]`));
    return match && match[1] !== undefined ? match[1] : "";
  }

  function extractStringArray(key: string): string[] {
    // eslint-disable-next-line security/detect-non-literal-regexp -- key is only ever a hardcoded metadata field name (see callers below), never user input.
    const match = source.match(new RegExp(`export\\s+const\\s+${key}\\s*=\\s*\\[([^\\]]*)\\]`));
    if (!match || match[1] === undefined) return [];
    const arrayContent = match[1];
    const items: string[] = [];
    const re = /["'`]([^"'`]*)["'`]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(arrayContent)) !== null) {
      if (m[1] !== undefined) items.push(m[1]);
    }
    return items;
  }

  return {
    name: extractString("name") || slug,
    slug,
    description: extractString("description") || "",
    dependencies: extractStringArray("dependencies"),
    modes: extractStringArray("modes") as ViewMode[] || ["page"],
    rendersCardTypes: extractStringArray("rendersCardTypes"),
    lastModified: mtime,
  };
}

/**
 * Compile a single view file. Returns { output, meta } or throws.
 * `target` selects React resolution (browser shim vs bare Node specifiers) —
 * see {@link ViewCompileTarget}; defaults to "browser".
 */
export async function compileView(
  viewPath: string,
  opts?: { target?: ViewCompileTarget; external?: string[] }
): Promise<{ output: string; meta: ViewMeta }> {
  const target = opts?.target ?? "browser";
  // Extra bare specifiers to leave unbundled. Figure sketches receive their
  // runtime library (p5/three/d3) as an argument from the harness; marking
  // those external means a stray `import p5` fails loudly at load instead of
  // esbuild trying (and failing) to resolve it from the attach dir.
  const extraExternal = opts?.external ?? [];
  const stat = await fs.stat(viewPath);
  const mtime = stat.mtimeMs;
  const slug = slugFromFilename(viewPath);

  // Key the cache by target too: the browser and node builds of the same file
  // produce incompatible output (window shim vs bare imports), so sharing one
  // slot would let one target's compile poison the other's. Externals go in the
  // key as well, so the same file compiled with and without them never collides.
  const cacheKey = `${target}:${extraExternal.join(",")}:${viewPath}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.mtime === mtime) {
    return { output: cached.output, meta: cached.meta };
  }

  const source = await fs.readFile(viewPath, "utf-8");
  const meta = extractMeta(source, { slug, mtime: stat.mtime.toISOString() });

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
            // Resolved from node_modules via the package `exports` map — see the
            // `cb view test` temp-dir symlink in src/cli/commands/view.ts.
            "callback-box/view-widgets",
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
  cache.set(cacheKey, { mtime, output, meta });
  return { output, meta };
}

/**
 * Edit-time compile check for the validation hooks: returns null if the view
 * compiles, or a human-readable error message otherwise. Compile only — no
 * execution, no type-check (the deeper signal is `cb view test`). Shared by the
 * shell `cb validate --hook` and the in-process `cardValidatorHook` so both
 * surface the same error. Uses the default browser target — the exact compile
 * the running app does.
 */
export async function lintViewFile(viewPath: string): Promise<string | null> {
  try {
    await compileView(viewPath);
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
  return window.__cbReact.createElement("pre", {style:{color:"red",whiteSpace:"pre-wrap",padding:"1rem"}}, \`${escaped}\`);
}
export const name = "Error";
export const description = "Failed to compile";
export const dependencies = [];
export const modes = ["page", "chat"];
`;
}

/**
 * List all views in a box's views/ directory.
 */
export async function listViews(boxRoot: string): Promise<ViewMeta[]> {
  const viewsDir = path.join(boxRoot, "views");
  try {
    await fs.access(viewsDir);
  } catch (_e) {
    // fs.access throwing means the box has no views/ directory — a box with no
    // views is normal, so return an empty list. The error carries no
    // actionable info beyond "directory absent".
    return [];
  }

  const files = await glob("*.tsx", { cwd: viewsDir });
  const metas: ViewMeta[] = [];

  for (const file of files) {
    const viewPath = path.join(viewsDir, file);
    try {
      const { meta } = await compileView(viewPath);
      metas.push(meta);
    } catch (_e) {
      // The view doesn't compile, but its metadata is regex-extracted from
      // source (no compile needed), so still surface `rendersCardTypes`: a
      // transient compile error mid-edit shouldn't make a bound card silently
      // abandon its custom renderer, which is what renders the inline compile
      // error (via the route's buildErrorModule). Description flags the failure
      // for the listing UI; reading source can itself fail (e.g. deleted between
      // glob and read), so fall back to a slug-only meta there.
      const slug = slugFromFilename(file);
      const stat = await fs.stat(viewPath);
      try {
        const source = await fs.readFile(viewPath, "utf-8");
        const partial = extractMeta(source, { slug, mtime: stat.mtime.toISOString() });
        metas.push({ ...partial, description: "Failed to compile" });
      } catch (_readErr) {
        metas.push({
          name: slug,
          slug,
          description: "Failed to compile",
          dependencies: [],
          modes: ["page"],
          rendersCardTypes: [],
          lastModified: stat.mtime.toISOString(),
        });
      }
    }
  }

  return metas;
}

/**
 * Invalidate cache for a specific view file (all compile targets).
 */
export function invalidateView(viewPath: string): void {
  cache.delete(`browser:${viewPath}`);
  cache.delete(`node:${viewPath}`);
}
