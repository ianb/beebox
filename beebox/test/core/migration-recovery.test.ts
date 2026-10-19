// # Migration snapshots preserve all three versions without cleaning a dirty box
//
// The recovery ref keeps HEAD, staged-only bytes, and working bytes independently.
// Ignored state stays ignored; an unrelated binary is preserved without invoking
// application commit hooks. Changed-path detection excludes earlier dirty input.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, not } from "@ianbicking/tap-check/check";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox, type TmpBox } from "../helpers/test-helpers.js";
import {
  captureMigrationSnapshot,
  changedMigrationPaths,
  restoreMigrationIndex,
} from "../../src/core/migration-recovery.js";

function git(box: TmpBox, ...args: string[]) {
  return execFileSync("git", args, { cwd: box.root, encoding: "utf8" }).trim();
}

void test("line 22", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await box.write("tracked.txt", "original\n");
  await box.write("unrelated.txt", "original unrelated\n");
  await box.commitAll("baseline");
  await box.write("tracked.txt", "staged only\n");
  git(box, "add", "tracked.txt");
  await box.write("tracked.txt", "working only\n");
  await box.write("unrelated.txt", "unrelated staging\n");
  git(box, "add", "unrelated.txt");
  await box.write("input.bin", "binary input\0bytes");
  await box.write(".beebox/private", "ignored\n");
  await box.write(".gitattributes", "filtered.txt filter=fixture\n");
  git(box, "config", "filter.fixture.clean", "tr a-z A-Z");
  await box.write("filtered.txt", "filtered input\n");
  const gitDir = git(box, "rev-parse", "--absolute-git-dir");
  const indexBefore = await readFile(join(gitDir, "index"));
  const head = git(box, "rev-parse", "HEAD");
  const hook = join(gitDir, "hooks/pre-commit");
  await writeFile(hook, "#!/bin/sh\nexit 1\n");
  await chmod(hook, 0o755);
  const snapshot = await captureMigrationSnapshot(box.root, "fixture");
  t.check({ head: git(box, "rev-parse", "HEAD"), index: (await readFile(join(gitDir, "index"))).toString("hex"), working: git(box, "show", `${snapshot.ref}:tracked.txt`), staged: git(box, "show", `${snapshot.ref}^2:tracked.txt`), tree: git(box, "ls-tree", "-r", "--name-only", snapshot.ref), binary: git(box, "show", `${snapshot.ref}:input.bin`) }, {
    head,
    index: indexBefore.toString("hex"),
    working: "working only",
    staged: "staged only",
    // The tree lists the whole scaffolded box; only the ignored path matters.
    tree: not(any(String).includes(".beebox/private")),
    binary: "binary input\u0000bytes",
  });

  t.check(git(box, "show", `${snapshot.ref}:filtered.txt`), "FILTERED INPUT");

  t.check(await changedMigrationPaths(box.root, snapshot), []);

  await box.write("tracked.txt", "migrated\n");
  await box.write("new[card].txt", "new output\n");
  const paths = await changedMigrationPaths(box.root, snapshot);
  t.check(paths.toSorted(), [
    "new[card].txt",
    "tracked.txt",
  ]);

  // A rejected output commit must restore the staged-only version and remove new
  // staging, while leaving unrelated staging and migrated working content intact.
  // Git pathspec metacharacters in a filename must remain literal.

  git(box, "add", "--", "tracked.txt", "new[card].txt");
  await t.checkThrows(async () => (git(box, "commit", "--only", "-m", "rejected migration", "--", ...paths)), "Error");

  await restoreMigrationIndex(box.root, { snapshot, paths: [...paths, "never-staged.txt"] });
  t.check({ staged: git(box, "show", ":tracked.txt"), unrelated: git(box, "show", ":unrelated.txt"), newStaged: git(box, "ls-files", "new[card].txt"), working: await box.read("tracked.txt"), newWorking: await box.read("new[card].txt") }, {
    staged: "staged only",
    unrelated: "unrelated staging",
    newStaged: "",
    working: `migrated
`,
    newWorking: `new output
`,
  });

  const again = await captureMigrationSnapshot(box.root, "fixture");
  t.check(again.ref, not(snapshot.ref));

  // An unresolved merge must fail before a recovery ref claims usable input.
  const blob = git(box, "rev-parse", "HEAD:tracked.txt");
  execFileSync("git", ["update-index", "--index-info"], { cwd: box.root, input: `0 ${"0".repeat(40)}\ttracked.txt\n100644 ${blob} 1\ttracked.txt\n100644 ${blob} 2\ttracked.txt\n100644 ${blob} 3\ttracked.txt\n` });
  await t.checkThrows(async () => (await captureMigrationSnapshot(box.root, "unmerged")), "Error");
});
