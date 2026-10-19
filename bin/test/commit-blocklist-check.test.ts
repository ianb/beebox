// # Commit blocklists in linked worktrees
//
// A linked worktree tries its own gitignored blocklist first, then shares the
// main checkout's machine-local list beside Git's common directory.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import path from "node:path";
import { blocklistCandidates } from "../commit-blocklist-check.js";

void test("line 11", async (t) => {
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
