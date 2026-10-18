// # Git Utilities
//
// Tests for the git helper functions in `src/lib/git/core.ts`.

import { test } from "tap";
import "agent-doctest/tap";
import { any, isoDate } from "agent-doctest/check";
import {
  initRepo, isRepo, getStatus, stageFiles, stageAll,
  commit, getLog, getLogPaginated, getDiff, getCommitDiff,
  hasCommits, getHead, clean, isNothingToCommitError,
  stageAndCommitPaths,
} from "../../src/lib/git/core/operations.js";
import {
  getCurrentBranch, createBranch, checkoutBranch, createTag, deleteTag,
} from "../../src/lib/git-refs.js";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { rename } from "node:fs/promises";
import { writeFile as writeFileFs, rm as rmFs } from "node:fs/promises";
import { join as joinPath } from "node:path";

// Commit hashes and dates change each run; the shape is fixed.
const sha = any(String).matches(/^[\da-f]{40}$/);
// The init commit's file counts follow whatever box init writes.
const initStat = {
  added: any(Number).int(),
  modified: 0,
  deleted: 0,
  renamed: 0,
  insertions: any(Number).int(),
  deletions: 0,
};

// ## stageAll skips oversized blobs (housekeeping guard)
//
// A blind `stageAll` (the housekeeping sweep) must never stage a regular file
// over the size limit (10MB), so a stray big file can't bloat the box repo.
// The check is on the staged object size, so git-lfs media (pointers) would
// pass — here we just verify a plain oversized file is left unstaged while a
// normal file alongside it stages fine.

// ## Repository detection
void test("Repository detection", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L22
  const box = await makeTmpBox({ git: "none" });
  t.check(await isRepo(box.root), false);

  // doctest:L28
  await initRepo(box.root);
  t.check(await isRepo(box.root), true);
});

// ## Initial state
//
// A freshly initialized repo has no commits and a clean status:
void test("A freshly initialized repo has no commits and a clean status:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L42
  const box = await makeTmpBox({ git: true });
  t.check(await hasCommits(box.root), true);

  // doctest:L46
  t.check(await getCurrentBranch(box.root), "main");

  // doctest:L51
  t.check(await getStatus(box.root), { staged: [], modified: [], untracked: [], clean: true });
});

// ## Staging and status
void test("Staging and status", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L66
  const box = await makeTmpBox({ git: true });
  await box.write("file.txt", "hello");
  t.check(await getStatus(box.root), { staged: [], modified: [], untracked: ["file.txt"], clean: false });

  // doctest:L72
  await stageFiles(box.root, ["file.txt"]);
  t.check(await getStatus(box.root), { staged: ["file.txt"], modified: [], untracked: [], clean: false });
});

// ## Stage all
void test("Stage all", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L90
  const box = await makeTmpBox({ git: true });
  await box.write("a.txt", "a");
  await box.write("b.txt", "b");
  await stageAll(box.root);
  t.check(await getStatus(box.root), { staged: ["a.txt", "b.txt"], modified: [], untracked: [], clean: false });
});

// ## Commit and log
void test("Commit and log", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L106
  const box = await makeTmpBox({ git: true });
  await box.write("file.txt", "content");
  await stageAll(box.root);
  const hash = await commit(box.root, { message: "Add file" });
  t.check(hash, sha);

  // doctest:L112
  t.check(await getLog(box.root), [
    { hash: sha, date: isoDate(), subject: "Add file", body: undefined, trailers: undefined },
    { hash: sha, date: isoDate(), subject: "init", body: undefined, trailers: undefined },
  ]);
});

// ## Commit with trailers
void test("Commit with trailers", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L128
  const box = await makeTmpBox({ git: true });
  await box.write("file.txt", "content");
  await stageAll(box.root);
  await commit(box.root, {
    message: "Do work",
    trailers: { Step: "fetch", Session: "abc-123" },
  });

  // doctest:L136
  t.check(await getLog(box.root), [
    {
      hash: sha,
      date: isoDate(),
      subject: "Do work",
      body: `Step: fetch
Session: abc-123`,
      trailers: { Step: "fetch", Session: "abc-123" },
    },
    { hash: sha, date: isoDate(), subject: "init", body: undefined, trailers: undefined },
  ]);
});

// ## getLogPaginated with multi-value trailers
void test("getLogPaginated with multi-value trailers", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L153
  const box = await makeTmpBox({ git: true });
  await box.write("file.txt", "v1");
  await stageAll(box.root);
  await commit(box.root, {
    message: "Multi-trailer",
    trailers: { Tag: "a" },
  });

  // doctest:L161
  t.check(await getLogPaginated({ boxRoot: box.root }), [
    {
      hash: sha,
      date: isoDate(),
      subject: "Multi-trailer",
      body: "Tag: a",
      trailers: { Tag: "a" },
      fileStat: { added: 1, modified: 0, deleted: 0, renamed: 0, insertions: 1, deletions: 0 },
    },
    { hash: sha, date: isoDate(), subject: "init", body: undefined, trailers: undefined, fileStat: initStat },
  ]);

  // doctest:L167
  // Pagination: offset skips entries
  t.check(await getLogPaginated({ boxRoot: box.root, offset: 1 }), [
    { hash: sha, date: isoDate(), subject: "init", body: undefined, trailers: undefined, fileStat: initStat },
  ]);
});

// ## getDiff
void test("getDiff", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L180
  const box = await makeTmpBox({ git: true });
  await box.write("file.txt", "original");
  await stageAll(box.root);
  await commit(box.root, { message: "Add file" });

  // doctest:L185
  // Modify the file
  await box.write("file.txt", "modified");
  t.checkText(await getDiff(box.root), `diff --git a/file.txt b/file.txt
index 94f3610..d84012f 100644
--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-original
\\ No newline at end of file
+modified
\\ No newline at end of file`);

  // doctest:L196
  // Staged diff
  await stageAll(box.root);
  t.checkText(await getDiff(box.root, true), `diff --git a/file.txt b/file.txt
index 94f3610..d84012f 100644
--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-original
\\ No newline at end of file
+modified
\\ No newline at end of file`);
});

// ## getCommitDiff
void test("getCommitDiff", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L210
  const box = await makeTmpBox({ git: true });
  await box.write("file.txt", "content");
  await stageAll(box.root);
  const hash = await commit(box.root, { message: "Add file" });

  // doctest:L215
  t.checkText(await getCommitDiff(box.root, hash), `diff --git a/file.txt b/file.txt
new file mode 100644
index 0000000..6b584e8
--- /dev/null
+++ b/file.txt
@@ -0,0 +1 @@
+content
\\ No newline at end of file`);
});

// ## getHead
void test("getHead", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L227
  const box = await makeTmpBox({ git: true });
  t.check(await getHead(box.root), sha);
});

// ## Branches
void test("Branches", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L240
  const box = await makeTmpBox({ git: true });
  t.check(await getCurrentBranch(box.root), "main");

  // doctest:L244
  await createBranch(box.root, "feature");
  t.check(await getCurrentBranch(box.root), "feature");

  // doctest:L248
  await checkoutBranch(box.root, "main");
  t.check(await getCurrentBranch(box.root), "main");
});

// ## Tags
void test("Tags", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L260
  const box = await makeTmpBox({ git: true });
  await createTag(box.root, "v1.0");
  // Tag exists — getHead should still work
  t.check(await getHead(box.root), sha);

  // doctest:L269
  // Delete the tag (no error)
  await deleteTag(box.root, "v1.0");
  t.check("deleted", "deleted");
});

// ## Clean removes untracked files
void test("Clean removes untracked files", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L282
  const box = await makeTmpBox({ git: true });
  await box.write("tracked.txt", "keep");
  await stageAll(box.root);
  await commit(box.root, { message: "Add tracked" });

  // doctest:L287
  await box.write("untracked.txt", "remove");
  t.check(await getStatus(box.root), { staged: [], modified: [], untracked: ["untracked.txt"], clean: false });

  // doctest:L291
  await clean(box.root);
  t.check(await getStatus(box.root), { staged: [], modified: [], untracked: [], clean: true });
});

// ## Empty log on repo with no matching commits
void test("Empty log on repo with no matching commits", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L306
  const box = await makeTmpBox({ git: true });
  t.check(await getLog(box.root, 0), []);
});

void test("stageAll skips oversized blobs (housekeeping guard)", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L330
  const box = await makeTmpBox({ git: true });
  await writeFileFs(joinPath(box.root, "small.txt"), "ok");
  // 11MB regular file — over the 10MB housekeeping limit.
  await writeFileFs(joinPath(box.root, "big.bin"), Buffer.alloc(11 * 1024 * 1024, 1));

  // doctest:L335
  // Silence the documented console.warn about the skipped file.
  const _warn = console.warn; console.warn = () => {};
  await stageAll(box.root);
  console.warn = _warn;

  // doctest:L340
  // small.txt is staged (added); big.bin is NOT staged (left as untracked).
  // getStatus reports repo-root-relative paths; the box root IS the repo root.
  t.check(await getStatus(box.root), { staged: ["small.txt"], modified: [], untracked: ["big.bin"], clean: false });
});

// ## stageAll stages deletions, and still catches an oversized file alongside one
//
// The size check asks git for each staged path's blob. A staged *deletion* has no
// blob, so it answers "missing" — and that must be a skip, not a failure: a
// deletion is not "adding a big file". The case is worth pinning because the
// check is batched into one `git cat-file --batch-check` call, where a thrown
// error would abandon the whole check and let a genuinely oversized file through
// whenever a deletion happened to be staged in the same sweep.
void test("The size check asks git for each staged path's blob.", async (t) => {
  t.teardown(async () => {
    try {
      await dbox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L364
  const dbox = await makeTmpBox({ git: true });
  await writeFileFs(joinPath(dbox.root, "doomed.txt"), "delete me");
  await stageAll(dbox.root);
  await commit(dbox.root, { message: "add doomed.txt" });

  // doctest:L369
  // Now delete it, and add an oversized file in the same sweep.
  await rmFs(joinPath(dbox.root, "doomed.txt"));
  await writeFileFs(joinPath(dbox.root, "huge.bin"), Buffer.alloc(11 * 1024 * 1024, 1));

  // doctest:L373
  const _warn2 = console.warn; console.warn = () => {};
  await stageAll(dbox.root);
  console.warn = _warn2;

  // doctest:L377
  // The deletion staged normally, and the oversized file was still caught, which
  // is what would break if a missing blob aborted the check.
  t.check(await getStatus(dbox.root), { staged: ["doomed.txt"], modified: [], untracked: ["huge.bin"], clean: false });
});

// ## isNothingToCommitError recognizes git's empty-commit message
//
// When the box's own auto-commit (`git add -A`) wins the race, an explicit
// `commit` exits non-zero with git's "nothing to commit" text — the same output
// that leaked from the clerk 500. The detector recognizes it so callers can treat
// it as success (the content IS committed) rather than an error, and leaves real
// git failures alone.
void test("When the box's own auto-commit (git add -A) wins the race, an explicit commit...", async (t) => {
  // doctest:L401
  t.check(isNothingToCommitError(new Error("On branch main\nnothing to commit, working tree clean\n")), true);

  // doctest:L404
  t.check(isNothingToCommitError(new Error("fatal: not a git repository (or any of the parent directories): .git")), false);
});

// ## stageAndCommitPaths — stage + path-scoped commit with race tolerance
//
// `stageAndCommitPaths` stages exactly `paths` and commits only them (via
// `commitPaths`), so a concurrent mutator's unrelated staged files can't be
// co-committed under this caller's attribution. It returns the new commit hash.
void test("stageAndCommitPaths stages exactly paths and commits only them (via commitPat...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L415
  const box = await makeTmpBox({ git: true });
  await box.write("note.card", "hi");
  const hash = await stageAndCommitPaths(box.root, {
    paths: ["note.card"],
    message: "Add note",
    trailers: { "Created-By": "clerk-api" },
  });
  t.check(hash, sha);

  // doctest:L424
  t.check(await getLog(box.root), [
    {
      hash: sha,
      date: isoDate(),
      subject: "Add note",
      body: "Created-By: clerk-api",
      trailers: { "Created-By": "clerk-api" },
    },
    { hash: sha, date: isoDate(), subject: "init", body: undefined, trailers: undefined },
  ]);

  // Only the named paths land — a concurrently-staged unrelated file is left
  // staged, NOT swept into this commit:

  // doctest:L437
  await box.write("scoped.card", "mine");
  await box.write("other.card", "someone else's staged work");
  await stageFiles(box.root, ["other.card"]);

  // doctest:L441
  await stageAndCommitPaths(box.root, { paths: ["scoped.card"], message: "Add scoped" });
  const committed = await getCommitDiff(box.root, await getHead(box.root));
  t.checkText(committed, `diff --git a/scoped.card b/scoped.card
new file mode 100644
index 0000000..c7ad82c
--- /dev/null
+++ b/scoped.card
@@ -0,0 +1 @@
+mine
\\ No newline at end of file`);
  // getStatus paths are repo-root-relative (repo root = package root).
  t.check(await getStatus(box.root), { staged: ["other.card"], modified: [], untracked: [], clean: false });

  // Fast path — nothing to commit returns `null` instead of throwing. Both an
  // already-committed path (no changes) and an empty path list land here:

  // doctest:L458
  t.check(await stageAndCommitPaths(box.root, { paths: ["scoped.card"], message: "no-op" }), null);

  // doctest:L461
  t.check(await stageAndCommitPaths(box.root, { paths: [], message: "empty" }), null);

  // A non-ASCII path commits by its real name. Git quotes such a path in
  // `--name-only` output unless `-z` is used, and the quoted form fails as a commit
  // pathspec (this stopped a box's migration on a `photo-…-pharmacín-….image.card`).

  // doctest:L470
  await box.write("café-menu.card", "carte");
  const unicodeHash = await stageAndCommitPaths(box.root, { paths: ["café-menu.card"], message: "Add café" });
  t.check(unicodeHash, sha);
  t.checkText(await getCommitDiff(box.root, await getHead(box.root)), `diff --git "a/caf\\303\\251-menu.card" "b/caf\\303\\251-menu.card"
new file mode 100644
index 0000000..6b295cc
--- /dev/null
+++ "b/caf\\303\\251-menu.card"
@@ -0,0 +1 @@
+carte
\\ No newline at end of file`);

  // A rename commits both halves. Rename detection must not collapse the staged
  // path list to only the destination and leave the source deletion behind.

  // doctest:L483
  await box.write("before.card", "move me");
  await box.commitAll("add before");
  await rename(box.path("before.card"), box.path("after.card"));
  await stageAndCommitPaths(box.root, { paths: ["before.card", "after.card"], message: "Move card" });
  t.check(await getStatus(box.root), { staged: [], modified: [], untracked: [], clean: true });
  t.checkText(await getCommitDiff(box.root, await getHead(box.root)), `diff --git a/before.card b/after.card
similarity index 100%
rename from before.card
rename to after.card`);
});
