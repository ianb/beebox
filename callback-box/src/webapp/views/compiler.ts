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

interface CacheEntry {
  mtime: number;
  output: string;
  meta: ViewMeta;
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
        return {
          contents: `const React = window.__cbReact;
export const jsx = React.createElement;
export const jsxs = React.createElement;
export const jsxDEV = React.createElement;
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

function slugFromFilename(filename: string): string {
  return path.basename(filename, ".tsx");
}

/**
 * Extract metadata from view source via regex on export const declarations.
 */
function extractMeta(source: string, { slug, mtime }: { slug: string; mtime: string }): ViewMeta {
  function extractString(key: string): string {
    const match = source.match(new RegExp(`export\\s+const\\s+${key}\\s*=\\s*["'\`]([^"'\`]*)["'\`]`));
    return match && match[1] !== undefined ? match[1] : "";
  }

  function extractStringArray(key: string): string[] {
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
    lastModified: mtime,
  };
}

/**
 * Compile a single view file. Returns { output, meta } or throws.
 */
export async function compileView(viewPath: string): Promise<{ output: string; meta: ViewMeta }> {
  const stat = await fs.stat(viewPath);
  const mtime = stat.mtimeMs;
  const slug = slugFromFilename(viewPath);

  const cached = cache.get(viewPath);
  if (cached && cached.mtime === mtime) {
    return { output: cached.output, meta: cached.meta };
  }

  const source = await fs.readFile(viewPath, "utf-8");
  const meta = extractMeta(source, { slug, mtime: stat.mtime.toISOString() });

  const result = await esbuild.build({
    stdin: {
      contents: source,
      loader: "tsx",
      resolveDir: path.dirname(viewPath),
      sourcefile: path.basename(viewPath),
    },
    bundle: true,
    format: "esm",
    target: "es2020",
    jsx: "automatic",
    write: false,
    plugins: [reactExternalPlugin],
  });

  const outputFile = result.outputFiles[0];
  if (!outputFile) {
    throw new Error(`esbuild produced no output for ${viewPath}`);
  }
  const output = outputFile.text;
  cache.set(viewPath, { mtime, output, meta });
  return { output, meta };
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
  } catch {
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
      const slug = slugFromFilename(file);
      const stat = await fs.stat(viewPath);
      metas.push({
        name: slug,
        slug,
        description: "Failed to compile",
        dependencies: [],
        modes: ["page"],
        lastModified: stat.mtime.toISOString(),
      });
    }
  }

  return metas;
}

/**
 * Invalidate cache for a specific view file.
 */
export function invalidateView(viewPath: string): void {
  cache.delete(viewPath);
}
