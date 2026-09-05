/**
 * Absolute path to the beebox package root.
 *
 * Resolved by walking up from this module's location until we find the
 * `beebox` package.json. This is bundle-safe: under tsx this module
 * lives at `src/lib/`, and in the esbuild bundle it lives at `dist/`, but
 * either way the upward walk lands on the same package root — so callers
 * can build paths to `bin/`, `templates/`, `tsconfig.json`, etc. without
 * hard-coding a `../..` depth that only holds for one source layout.
 *
 * Prefer this over `import.meta.dirname` + `../..` for anything that points
 * at a fixed asset relative to the package root.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

class PackageRootNotFoundError extends Error {
  constructor() {
    super("package-root: could not locate the beebox package root");
    this.name = "PackageRootNotFoundError";
  }
}

function findPackageRoot(): string {
  let dir = import.meta.dirname;
  for (;;) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.name === "beebox") return dir;
      } catch (_e) {
        // Unparseable package.json — keep walking up.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new PackageRootNotFoundError();
    }
    dir = parent;
  }
}

export const PACKAGE_ROOT = findPackageRoot();
