// # Commit blocklists in linked worktrees
//
// A linked worktree tries its own gitignored blocklist first, then shares the
// main checkout's machine-local list beside Git's common directory.

import { test } from "tap";
import "agent-doctest/tap";
import path from "node:path";
import { blocklistCandidates } from "../commit-blocklist-check.js";

void test("line 11", async (t) => {
  // doctest:L12
  t.check(
    blocklistCandidates({
      repoRoot: "/src/worktrees/topic",
      rel: ".commit-blocklist",
      commonDir: "/src/main/.git",
    }),
    [
    "/src/worktrees/topic/.commit-blocklist",
    "/src/main/.commit-blocklist",
  ],
  );

  // doctest:L19
  t.check(
    blocklistCandidates({
      repoRoot: "/src/main",
      rel: ".commit-blocklist",
      commonDir: "/src/main/.git",
    }),
    [
    "/src/main/.commit-blocklist",
  ],
  );

  // doctest:L26
  t.check(
    blocklistCandidates({
      repoRoot: "/src/main",
      rel: path.resolve("/private/list"),
      commonDir: "/src/main/.git",
    }),
    [
    "/private/list",
  ],
  );
});
