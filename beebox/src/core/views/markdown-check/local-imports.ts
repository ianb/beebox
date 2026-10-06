/**
 * The local source files a box view reaches through relative imports.
 *
 * A view's checks must follow its helpers: a view that imports
 * `./lib/prose.tsx` renders whatever that helper renders. This walks the
 * relative specifiers (`./…`, `../…`) of `import`, `export … from`,
 * `import()`, and `require()`, transitively, and returns every `.ts`/`.tsx`
 * file reached (the entry first). Bare specifiers (packages, `beebox/…`) are
 * not followed. Cycle-safe (each real path is visited once), and a specifier
 * whose file resolves outside `root` (after symlinks) is not followed.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

const SOURCE_EXTENSIONS = [".tsx", ".ts"];

/** Whether `child` is `root` or inside it. */
function isWithin(root: string, child: string): boolean {
  const rel = path.relative(root, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function isFile(p: string): Promise<boolean> {
  const st = await fs.stat(p).catch(() => null);
  return st?.isFile() === true;
}

/** The source file a relative specifier names, as a bundler resolves it; null when none exists. */
async function resolveLocal(fromFile: string, specifier: string): Promise<string | null> {
  const base = path.resolve(path.dirname(fromFile), specifier);
  // `./x.js` in TypeScript source names `./x.ts` / `./x.tsx`.
  const stem = /\.(?:m?js|jsx)$/.test(base) ? base.replace(/\.(?:m?js|jsx)$/, "") : base;
  const candidates = [
    ...(SOURCE_EXTENSIONS.some((ext) => base.endsWith(ext)) ? [base] : []),
    ...SOURCE_EXTENSIONS.map((ext) => stem + ext),
    ...SOURCE_EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
  ];
  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

/**
 * `entry` and every local `.ts`/`.tsx` file it reaches, as real absolute
 * paths, in visit order. `listSpecifiers` gives a file's import specifiers
 * (the caller parses; see `markdown-check.ts`).
 */
export async function localImportClosure(
  entry: string,
  { root, listSpecifiers }: { root: string; listSpecifiers: (source: string) => string[] },
): Promise<{ path: string; source: string }[]> {
  const realRoot = await fs.realpath(root);
  const seen = new Set<string>();
  const out: { path: string; source: string }[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) break;
    const real = await fs.realpath(next).catch(() => null);
    if (real === null || seen.has(real) || !isWithin(realRoot, real)) continue;
    seen.add(real);
    let source: string;
    try {
      source = await fs.readFile(real, "utf-8");
    } catch (_e) {
      continue; // unreadable: the compile check's concern
    }
    out.push({ path: real, source });
    for (const specifier of listSpecifiers(source)) {
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;
      const resolved = await resolveLocal(real, specifier);
      if (resolved !== null) queue.push(resolved);
    }
  }
  return out;
}
