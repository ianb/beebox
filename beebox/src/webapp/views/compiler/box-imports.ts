/**
 * Two helpers for bundling box code (views and figures) with esbuild.
 *
 * `boxRootImportsPlugin` resolves `@/…` specifiers from the box root, so
 * `import { atomColor } from "@/src/lib/chem.ts"` means the same file from
 * any card or view, and a moved card's imports keep working. The box's
 * tsconfig maps the same prefix (`beebox/tsconfig.base.json`, `paths`), so
 * editors and `tsc` agree with the bundler.
 *
 * `bundleInputs` / `inputsUnchanged` let the compile cache notice an edited
 * *imported* file: the cache records every on-disk input the bundle read,
 * not only the entry.
 */

import type * as esbuild from "esbuild";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export const BOX_ROOT_PREFIX = "@/";

/** Resolve `@/<path>` against `boxRoot`; null when the box root is unknown. */
export function boxRootImportsPlugin(boxRoot: string | null): esbuild.Plugin {
  return {
    name: "box-root-imports",
    setup(build) {
      build.onResolve({ filter: /^@\// }, async (args) => {
        if (boxRoot === null) {
          return { errors: [{ text: `"${args.path}": @/ imports resolve from the box root, and this file is not in a box` }] };
        }
        const rest = args.path.slice(BOX_ROOT_PREFIX.length);
        const absolute = path.resolve(boxRoot, rest);
        const relative = path.relative(boxRoot, absolute);
        if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
          return { errors: [{ text: `"${args.path}" leaves the box root` }] };
        }
        // Delegate to esbuild's own resolver so extension and index lookup
        // behave as for a relative import. "./…" can't match this filter again.
        const resolved = await build.resolve(`./${relative.split(path.sep).join("/")}`, {
          resolveDir: boxRoot,
          kind: args.kind,
          importer: args.importer,
        });
        if (resolved.errors.length > 0) return { errors: resolved.errors };
        // A symlink inside the box can point outside it; the bundle is served
        // to the browser, so the real file must be in the box too.
        if (!(await realInside(boxRoot, resolved.path))) {
          return { errors: [{ text: `"${args.path}" resolves outside the box root` }] };
        }
        return { path: resolved.path, namespace: resolved.namespace, sideEffects: resolved.sideEffects };
      });
    },
  };
}

/** True when `file`'s real path lies under `root`'s real path. */
async function realInside(root: string, file: string): Promise<boolean> {
  const [realRoot, realFile] = await Promise.all([fs.realpath(root), fs.realpath(file)]);
  const relative = path.relative(realRoot, realFile);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** An on-disk file a bundle read, with the stat fields the cache compares. */
export interface BundleInput {
  file: string;
  mtime: number;
  size: number;
}

/**
 * The on-disk inputs of a build, from its metafile. Inputs in a plugin
 * namespace (`ns:…`) and `<stdin>` have no file, so a failed stat drops them.
 */
export async function bundleInputs(metafile: esbuild.Metafile, workingDir: string): Promise<BundleInput[]> {
  const inputs: BundleInput[] = [];
  for (const name of Object.keys(metafile.inputs)) {
    const file = path.resolve(workingDir, name);
    try {
      const stat = await fs.stat(file);
      inputs.push({ file, mtime: stat.mtimeMs, size: stat.size });
    } catch (_e) {
      // Not a file on disk (a shim namespace or stdin): nothing to watch.
    }
  }
  return inputs;
}

/** True when every recorded input still has the same mtime and size. */
export async function inputsUnchanged(inputs: readonly BundleInput[]): Promise<boolean> {
  for (const input of inputs) {
    try {
      const stat = await fs.stat(input.file);
      if (stat.mtimeMs !== input.mtime || stat.size !== input.size) return false;
    } catch (_e) {
      return false;
    }
  }
  return true;
}
