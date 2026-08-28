/**
 * A synthetic package tree for the graph tests: the real esbuild pass runs over
 * it, so ambiguity, directory-vs-file candidates and dangling imports are
 * exercised for real rather than mocked.
 *
 * Shared by `test-graph.test.ts` (the graph itself) and
 * `test-graph-cache.test.ts` (the content-keyed cache over it).
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { testEntrypoints, type GraphConfig } from "./test-graph.js";

export interface Fixture {
  root: string;
  config: GraphConfig;
  cleanup: () => void;
}

/** Write a fixture package: `files` maps package-relative path -> contents. */
export function fixture(files: Record<string, string>): Fixture {
  const root = mkdtempSync(join(tmpdir(), "test-graph-"));
  const packageRoot = join(root, "pkg");
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(packageRoot, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
  }
  return {
    root,
    config: {
      repoRoot: root,
      packageRoot,
      aliases: { "@shared/": join(packageRoot, "src/shared") },
      entrypoints: testEntrypoints(packageRoot),
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

