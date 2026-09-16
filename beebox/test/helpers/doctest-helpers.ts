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
import { annexNewBox } from "../../src/core/annex/annex-new-box.js";
import { createGitAnnexService } from "../../src/services/git-annex.js";

export interface TmpBox {
  /** Absolute path to the box root — the one root; holds `.beebox/box.json`,
   * `package.json`, `node_modules/`, `src/`, and every underscore area.
   * Avoid using in expected output — temp dir names never appear there. */
  root: string;
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

/**
 * `git` — every box has a Git directory, because box admission
 * (`src/lib/box-maintenance.ts`) keeps its gate under `.git/`: a fixture
 * without one throws "Box maintenance requires a Git repository" the moment
 * anything acquires box work. So the default is a bare `git init` (~60 ms);
 * `true` adds the annex init and an initial commit that a committing test
 * needs (~1.1 s); `"none"` is for the two tests that assert gitlessness.
 */
export async function makeTmpBox(opts?: { git?: boolean | "none"; deps?: boolean }): Promise<TmpBox> {
  const root = await mkdtemp(join(tmpdir(), "bbx-doctest-"));

  // Build a minimal-but-valid shapeVersion-3 box via the same scaffolder
  // `bbx init` uses (`scaffoldBoxRoot`): package.json declaring beebox,
  // tsconfig, src/, the marker, every underscore area, .gitignore. `deps`
  // opts into the `node_modules/beebox` symlink — needed only by
  // view-compile and box-local-schema fixtures that resolve `beebox/*`
  // natively.
  await scaffoldBoxRoot(root, { deps: opts?.deps === true });

  // A box IS annex-shaped — there is no other kind, and no `annex` option to
  // declare it with. The annex step goes between `git init` and the initial
  // commit, where real `bbx init` does it (`announceAndInitGit`): annexing
  // after the commit would leave every fixture with a modified `.gitignore`
  // and reading as dirty.
  //
  // This runs the REAL binary rather than fabricating `.git/annex/`, which is
  // the point. The old fixture wrote that directory by hand, so annex fixtures
  // proved the ignore block did not block — not that bytes annex. "The fixture
  // never ran the real init" is what
  // `issues/bugs/2026-09-04-scan-import-gitignore-blocks-attach-staging.md`
  // names as the reason its bug went unnoticed for months.
  if (opts?.git !== "none") execSync("git init -q -b main", { cwd: root, stdio: "pipe" });
  if (opts?.git === true) {
    await annexNewBox(createGitAnnexService(), root);
    execSync("git add -A && git commit --allow-empty -m init -q", { cwd: root, stdio: "pipe" });
  }

  const box: TmpBox = {
    root,
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
          // The repository is fixture plumbing, not box content.
          if (d === root && item.name === ".git") continue;
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
      // git-annex marks object files AND their parent directories read-only so
      // content cannot be modified in place, which makes `rm` fail with EACCES
      // on any box that annexed something. Restore write permission first.
      try {
        execSync(`chmod -R u+w ${JSON.stringify(root)}`, { stdio: "pipe" });
      } catch (_e) {
        /* best-effort: the rm below reports anything that actually matters */
      }
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };

  return box;
}
