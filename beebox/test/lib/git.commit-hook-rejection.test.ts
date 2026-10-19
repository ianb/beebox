// # A commit a hook rejects is a failure, not a silent no-op
//
// `commit()` returns the new HEAD, and every caller reads that as "the commit
// landed". simple-git does not make that safe on its own: when a `pre-commit` or
// `commit-msg` hook exits non-zero, `.commit()` **resolves** with an empty result
// rather than rejecting. Reading HEAD afterwards then yields the PREVIOUS commit,
// which every caller would take as success.
//
// Boxes install both hooks (`bbx validate --staged`, `git annex pre-commit`), so a
// rejected commit is an ordinary path, not an exotic one. See
// `commitAndReadHead` in `src/lib/git/core.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { not } from "@ianbicking/tap-check/check";
import { execFileSync } from "node:child_process";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox, type TmpBox } from "../helpers/test-helpers.js";
import { commit, stageAll } from "../../src/lib/git/core/operations.js";

function git(box: TmpBox, ...args: string[]) {
  return execFileSync("git", args, { cwd: box.root }).toString().trim();
}

/** Install a pre-commit hook that always rejects. */
async function installRejectingHook(box: TmpBox) {
  const hookPath = join(git(box, "rev-parse", "--absolute-git-dir"), "hooks", "pre-commit");
  await writeFile(hookPath, "#!/bin/sh\nexit 1\n");
  await chmod(hookPath, 0o755);
}

async function catchName(promise: Promise<unknown>) {
  try { await promise; return "no-throw"; } catch (e) { return e instanceof Error ? e.name : String(e); }
}

// The commit throws, and HEAD is where it was:
void test("The commit throws, and HEAD is where it was:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await box.write("_content/inbox/Note.doc.card", "---\ntitle: Note\n---\nfirst\n");
  await box.commitAll("a real commit");
  const head = git(box, "rev-parse", "HEAD");

  await installRejectingHook(box);
  await box.write("_content/inbox/Rejected.doc.card", "---\ntitle: Note\n---\nnope\n");
  await stageAll(box.root);

  t.check(await catchName(commit(box.root, { message: "should not land" })), "CommitDidNotLandError");
  t.check(git(box, "rev-parse", "HEAD"), head);

  // The changes are still in the tree — a rejected commit loses no work, it just
  // must not be reported as done:

  await t.checkText(git(box, "status", "--porcelain"), "A  _content/inbox/Rejected.doc.card");

  // With the hook passing again, the same commit lands and returns a new HEAD:

  const hookPath = join(git(box, "rev-parse", "--absolute-git-dir"), "hooks", "pre-commit");
  await writeFile(hookPath, "#!/bin/sh\nexit 0\n");
  const sha = await commit(box.root, { message: "lands this time" });
  t.check(sha, git(box, "rev-parse", "HEAD"));
  t.check(sha, not(head));
});
