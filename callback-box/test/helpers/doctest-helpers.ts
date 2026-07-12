/**
 * Shared helpers for filesystem-based doctests.
 *
 * All output methods return paths relative to the temp root,
 * so temp dir names never appear in doctest expected output.
 */

/* eslint-disable security/detect-non-literal-fs-filename */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { scaffoldPackageRoot } from "../../src/core/box/package.js";

export interface TmpBox {
  /** Absolute path to the operational box root (`<packageRoot>/content`).
   * Avoid using in expected output — temp dir names never appear there. */
  root: string;
  /** Absolute path to the package root (parent of `root`; holds
   * `package.json`, `node_modules/`, `src/`). Use for the ~15-20 callers that
   * reach package-level paths (`.claude/`, `src/views`, `src/tricks`, …). */
  packageRoot: string;
  /** Join a relative path with the box root. */
  path(relativePath: string): string;
  /** List files and dirs under a subdir, sorted, one per line. */
  list(subdir?: string): Promise<string>;
  /** Read file contents. */
  read(relativePath: string): Promise<string>;
  /** Write a file, creating parent dirs as needed. */
  write(relativePath: string, content: string): Promise<void>;
  /** Alias for write. */
  seed(relativePath: string, content: string): Promise<void>;
  /** Stage all and commit (only works if git was initialized). */
  commitAll(message: string): void;
  /** Remove the temp directory. */
  cleanup(): Promise<void>;
}

export async function makeTmpBox(opts?: { git?: boolean; deps?: boolean }): Promise<TmpBox> {
  const packageRoot = await mkdtemp(join(tmpdir(), "cb-doctest-"));

  // Build a minimal-but-valid shapeVersion-2 box: the package half at
  // `packageRoot` (package.json declaring callback-box, tsconfig, src/, root
  // .gitignore) plus the operational box marker at `packageRoot/content/.cb-box`
  // (that's `root`). `getBoxShape` needs exactly these two things. Kept cheap
  // — the content root stays empty (as the old flat marker-only box was), so
  // card-only fixtures that seed their own files under `root` are unaffected.
  // `deps` opts into the `node_modules/callback-box` symlink — needed only by
  // view-compile and box-local-schema fixtures that resolve `callback-box/*`
  // natively.
  await scaffoldPackageRoot(packageRoot, { symlinkCallbackBox: opts?.deps === true });
  const root = join(packageRoot, "content");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, ".cb-box"), JSON.stringify({ shapeVersion: 2 }) + "\n");

  if (opts?.git) {
    // Git lives at the PACKAGE root (the whole v2 package is one repo).
    execSync("git init -q && git add -A && git commit --allow-empty -m init -q", {
      cwd: packageRoot,
      stdio: "pipe",
    });
  }

  const box: TmpBox = {
    root,
    packageRoot,
    path(relativePath: string) {
      return join(root, relativePath);
    },
    async list(subdir?: string) {
      const dir = subdir ? join(root, subdir) : root;
      const entries: string[] = [];
      async function walk(d: string) {
        let items: Awaited<ReturnType<typeof readdir>>;
        try {
          items = await readdir(d, { withFileTypes: true });
        } catch {
          return;
        }
        for (const item of items) {
          const rel = relative(root, join(d, item.name));
          entries.push(rel);
          if (item.isDirectory()) {
            await walk(join(d, item.name));
          }
        }
      }
      await walk(dir);
      entries.sort();
      return entries.join("\n");
    },
    async read(relativePath: string) {
      return readFile(join(root, relativePath), "utf-8");
    },
    async write(relativePath: string, content: string) {
      const fullPath = join(root, relativePath);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content);
    },
    async seed(relativePath: string, content: string) {
      return box.write(relativePath, content);
    },
    commitAll(message: string) {
      // Git lives at the package root — commit from there so the whole tree
      // (package files AND content/) is staged.
      execSync("git add -A && git commit --allow-empty -m " + JSON.stringify(message), {
        cwd: packageRoot,
        stdio: "pipe",
      });
    },
    async cleanup() {
      await rm(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };

  return box;
}
