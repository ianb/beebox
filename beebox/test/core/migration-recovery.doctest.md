# Migration snapshots preserve all three versions without cleaning a dirty box

The recovery ref keeps HEAD, staged-only bytes, and working bytes independently.
Ignored state stays ignored; an unrelated binary is preserved without invoking
application commit hooks. Changed-path detection excludes earlier dirty input.

```ts setup
import { execFileSync } from "node:child_process";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import {
  captureMigrationSnapshot,
  changedMigrationPaths,
  restoreMigrationIndex,
} from "../../src/core/migration-recovery.js";
function git(box, ...args) {
  return execFileSync("git", args, { cwd: box.root, encoding: "utf8" }).trim();
}
```

```ts
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
JSON.stringify({ head: head === git(box, "rev-parse", "HEAD"), index: indexBefore.equals(await readFile(join(gitDir, "index"))), working: git(box, "show", `${snapshot.ref}:tracked.txt`), staged: git(box, "show", `${snapshot.ref}^2:tracked.txt`), ignored: git(box, "ls-tree", "-r", "--name-only", snapshot.ref).includes(".beebox/private"), binary: git(box, "show", `${snapshot.ref}:input.bin`) })
=> {"head":true,"index":true,"working":"working only","staged":"staged only","ignored":false,"binary":"binary input\u0000bytes"}

git(box, "show", `${snapshot.ref}:filtered.txt`)
=> FILTERED INPUT

await changedMigrationPaths(box.root, snapshot)
=> []

await box.write("tracked.txt", "migrated\n");
await box.write("new[card].txt", "new output\n");
const paths = await changedMigrationPaths(box.root, snapshot);
JSON.stringify(paths.sort())
=> ["new[card].txt","tracked.txt"]
```

A rejected output commit must restore the staged-only version and remove new
staging, while leaving unrelated staging and migrated working content intact.
Git pathspec metacharacters in a filename must remain literal.

```ts continue
git(box, "add", "--", "tracked.txt", "new[card].txt");
git(box, "commit", "--only", "-m", "rejected migration", "--", ...paths)
=> throws Error

await restoreMigrationIndex(box.root, { snapshot, paths: [...paths, "never-staged.txt"] });
JSON.stringify({ staged: git(box, "show", ":tracked.txt"), unrelated: git(box, "show", ":unrelated.txt"), newStaged: git(box, "ls-files", "new[card].txt"), working: await box.read("tracked.txt"), newWorking: await box.read("new[card].txt") })
=> {"staged":"staged only","unrelated":"unrelated staging","newStaged":"","working":"migrated\n","newWorking":"new output\n"}

const again = await captureMigrationSnapshot(box.root, "fixture");
again.ref !== snapshot.ref
=> true

// An unresolved merge must fail before a recovery ref claims usable input.
const blob = git(box, "rev-parse", "HEAD:tracked.txt");
execFileSync("git", ["update-index", "--index-info"], { cwd: box.root, input: `0 ${"0".repeat(40)}\ttracked.txt\n100644 ${blob} 1\ttracked.txt\n100644 ${blob} 2\ttracked.txt\n100644 ${blob} 3\ttracked.txt\n` });
await captureMigrationSnapshot(box.root, "unmerged")
=> throws Error
```

```ts cleanup
await box.cleanup();
```
