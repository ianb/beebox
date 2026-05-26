/**
 * Shared helpers for filesystem-based doctests.
 *
 * All output methods return paths relative to the temp root,
 * so temp dir names never appear in doctest expected output.
 */

/* eslint-disable security/detect-non-literal-fs-filename */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

export interface TmpBox {
  /** Absolute path to the temp root (avoid using in expected output). */
  root: string;
  /** Join a relative path with root. */
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

export async function makeTmpBox(opts?: { git?: boolean }): Promise<TmpBox> {
  const root = await mkdtemp(join(tmpdir(), "cb-doctest-"));

  // Box marker — code paths that walk up looking for a box (cb CLI, validation
  // hooks, generateDocs) require this. Cheap to always create; tests that
  // don't care simply ignore it.
  await writeFile(join(root, ".cb-box"), "");

  if (opts?.git) {
    execSync("git init -q && git add -A && git commit --allow-empty -m init -q", {
      cwd: root,
      stdio: "pipe",
    });
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
      const { dirname } = await import("node:path");
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
      await rm(root, { recursive: true, force: true });
    },
  };

  return box;
}
