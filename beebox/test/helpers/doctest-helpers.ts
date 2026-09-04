/**
 * Shared helpers for filesystem-based doctests.
 *
 * All output methods return paths relative to the temp root,
 * so temp dir names never appear in doctest expected output.
 */


import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { scaffoldBoxRoot } from "../../src/core/box/package.js";
import { makeBoxAnnexShaped } from "./annex-box.js";

export interface TmpBox {
  /** Absolute path to the box root — the one root; holds `.beebox/box.json`,
   * `package.json`, `node_modules/`, `src/`, and every underscore area.
   * Avoid using in expected output — temp dir names never appear there. */
  root: string;
  /** @deprecated Alias for `root` — shapeVersion 3 has one root. Kept so the
   * ~15-20 callers that still read `.packageRoot` keep compiling. */
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

export async function makeTmpBox(opts?: { git?: boolean; deps?: boolean; annex?: boolean }): Promise<TmpBox> {
  const root = await mkdtemp(join(tmpdir(), "bbx-doctest-"));

  // Build a minimal-but-valid shapeVersion-3 box via the same scaffolder
  // `bbx init` uses (`scaffoldBoxRoot`): package.json declaring beebox,
  // tsconfig, src/, the marker, every underscore area, .gitignore. `deps`
  // opts into the `node_modules/beebox` symlink — needed only by
  // view-compile and box-local-schema fixtures that resolve `beebox/*`
  // natively.
  await scaffoldBoxRoot(root, { deps: opts?.deps === true });

  if (opts?.git) {
    execSync("git init -q -b main && git add -A && git commit --allow-empty -m init -q", {
      cwd: root,
      stdio: "pipe",
    });
  }

  // `annex`: the box has been through `bbx attachments to-annex` — assets are
  // visible to git and the annex holds their bytes. Anything that writes asset
  // bytes into a box gates on this shape (see core/annex/is-annex-box.ts), so a
  // fixture exercising that path has to declare which side it is testing.
  if (opts?.annex) {
    await makeBoxAnnexShaped({ packageRoot: root, boxRoot: root });
  }

  const box: TmpBox = {
    root,
    packageRoot: root,
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
        } catch (_e) {
          /* ignore: unreadable/vanished directory — skip this subtree in the listing */
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
      execSync("git add -A && git commit --allow-empty -m " + JSON.stringify(message), {
        cwd: root,
        stdio: "pipe",
      });
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };

  return box;
}
