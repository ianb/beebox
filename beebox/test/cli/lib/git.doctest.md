# Git Utilities

Tests for the git helper functions in `src/lib/git.ts`.

```ts setup
import {
  initRepo, isRepo, getStatus, stageFiles, stageAll,
  commit, getLog, getLogPaginated, getDiff, getCommitDiff,
  hasCommits, getHead, clean, isNothingToCommitError,
  stageAndCommitPaths,
} from "../../../src/lib/git.js";
import {
  getCurrentBranch, createBranch, checkoutBranch, createTag, deleteTag,
} from "../../../src/lib/git-refs.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { rename } from "node:fs/promises";
```

## Repository detection

```ts
const box = await makeTmpBox();
await isRepo(box.root)
=> false
```

```ts continue
await initRepo(box.root);
await isRepo(box.root)
=> true
```

```ts cleanup
await box.cleanup();
```

## Initial state

A freshly initialized repo has no commits and a clean status:

```ts
const box = await makeTmpBox({ git: true });
await hasCommits(box.root)
=> true

await getCurrentBranch(box.root)
=> main
```

```ts continue
const status = await getStatus(box.root);
status.clean
=> true

status.staged.length
=> 0
```

```ts cleanup
await box.cleanup();
```

## Staging and status

```ts
const box = await makeTmpBox({ git: true });
await box.write("file.txt", "hello");
const s1 = await getStatus(box.root);
print(`untracked: ${s1.untracked.length}`);
print(`clean: ${s1.clean}`);

await stageFiles(box.root, ["file.txt"]);
const s2 = await getStatus(box.root);
print(`staged: ${s2.staged.length}`);
print(`clean: ${s2.clean}`);
=>
untracked: 1
clean: false
staged: 1
clean: false
```

```ts cleanup
await box.cleanup();
```

## Stage all

```ts
const box = await makeTmpBox({ git: true });
await box.write("a.txt", "a");
await box.write("b.txt", "b");
await stageAll(box.root);
const status = await getStatus(box.root);
status.staged.length
=> 2
```

```ts cleanup
await box.cleanup();
```

## Commit and log

```ts
const box = await makeTmpBox({ git: true });
await box.write("file.txt", "content");
await stageAll(box.root);
const hash = await commit(box.root, { message: "Add file" });
print(`hash length: ${hash.length}`);

const log = await getLog(box.root);
print(`entries: ${log.length}`);
print(`subject: ${log[0].subject}`);
=>
hash length: 40
entries: 2
subject: Add file
```

```ts cleanup
await box.cleanup();
```

## Commit with trailers

```ts
const box = await makeTmpBox({ git: true });
await box.write("file.txt", "content");
await stageAll(box.root);
await commit(box.root, {
  message: "Do work",
  trailers: { Step: "fetch", Session: "abc-123" },
});

const log = await getLog(box.root);
print(`subject: ${log[0].subject}`);
print(`Step: ${log[0].trailers?.Step}`);
print(`Session: ${log[0].trailers?.Session}`);
=>
subject: Do work
Step: fetch
Session: abc-123
```

```ts cleanup
await box.cleanup();
```

## getLogPaginated with multi-value trailers

```ts
const box = await makeTmpBox({ git: true });
await box.write("file.txt", "v1");
await stageAll(box.root);
await commit(box.root, {
  message: "Multi-trailer",
  trailers: { Tag: "a" },
});

const entries = await getLogPaginated({ boxRoot: box.root });
entries[0].subject
=> Multi-trailer
```

```ts continue
// Pagination: offset skips entries
const skipped = await getLogPaginated({ boxRoot: box.root, offset: 1 });
skipped[0].subject
=> init
```

```ts cleanup
await box.cleanup();
```

## getDiff

```ts
const box = await makeTmpBox({ git: true });
await box.write("file.txt", "original");
await stageAll(box.root);
await commit(box.root, { message: "Add file" });

// Modify the file
await box.write("file.txt", "modified");
const diff = await getDiff(box.root);
print(`has minus: ${diff.includes("-original")}`);
print(`has plus: ${diff.includes("+modified")}`);
=>
has minus: true
has plus: true
```

```ts continue
// Staged diff
await stageAll(box.root);
const stagedDiff = await getDiff(box.root, true);
stagedDiff.includes("+modified")
=> true
```

```ts cleanup
await box.cleanup();
```

## getCommitDiff

```ts
const box = await makeTmpBox({ git: true });
await box.write("file.txt", "content");
await stageAll(box.root);
const hash = await commit(box.root, { message: "Add file" });

const diff = await getCommitDiff(box.root, hash);
diff.includes("+content")
=> true
```

```ts cleanup
await box.cleanup();
```

## getHead

```ts
const box = await makeTmpBox({ git: true });
const head = await getHead(box.root);
head.length
=> 40
```

```ts cleanup
await box.cleanup();
```

## Branches

```ts
const box = await makeTmpBox({ git: true });
await getCurrentBranch(box.root)
=> main

await createBranch(box.root, "feature");
await getCurrentBranch(box.root)
=> feature

await checkoutBranch(box.root, "main");
await getCurrentBranch(box.root)
=> main
```

```ts cleanup
await box.cleanup();
```

## Tags

```ts
const box = await makeTmpBox({ git: true });
await createTag(box.root, "v1.0");
// Tag exists — getHead should still work
const head = await getHead(box.root);
head.length
=> 40
```

```ts continue
// Delete the tag (no error)
await deleteTag(box.root, "v1.0");
"deleted"
=> deleted
```

```ts cleanup
await box.cleanup();
```

## Clean removes untracked files

```ts
const box = await makeTmpBox({ git: true });
await box.write("tracked.txt", "keep");
await stageAll(box.root);
await commit(box.root, { message: "Add tracked" });

await box.write("untracked.txt", "remove");
const before = await getStatus(box.root);
print(`untracked before: ${before.untracked.length}`);

await clean(box.root);
const after = await getStatus(box.root);
print(`untracked after: ${after.untracked.length}`);
=>
untracked before: 1
untracked after: 0
```

```ts cleanup
await box.cleanup();
```

## Empty log on repo with no matching commits

```ts
const box = await makeTmpBox({ git: true });
const log = await getLog(box.root, 0);
log.length
=> 0
```

```ts cleanup
await box.cleanup();
```

## stageAll skips oversized blobs (housekeeping guard)

A blind `stageAll` (the housekeeping sweep) must never stage a regular file
over the size limit (10MB), so a stray big file can't bloat the box repo.
The check is on the staged object size, so git-lfs media (pointers) would
pass — here we just verify a plain oversized file is left unstaged while a
normal file alongside it stages fine.

```ts setup
import { writeFile as writeFileFs, rm as rmFs } from "node:fs/promises";
import { join as joinPath } from "node:path";
```

```ts
const box = await makeTmpBox({ git: true });
await writeFileFs(joinPath(box.root, "small.txt"), "ok");
// 11MB regular file — over the 10MB housekeeping limit.
await writeFileFs(joinPath(box.root, "big.bin"), Buffer.alloc(11 * 1024 * 1024, 1));

// Silence the documented console.warn about the skipped file.
const _warn = console.warn; console.warn = () => {};
await stageAll(box.root);
console.warn = _warn;

const status = await getStatus(box.root);
// small.txt is staged (added); big.bin is NOT staged (left as untracked).
// getStatus reports repo-root-relative paths; the box root IS the repo root.
status.staged.includes("small.txt")
=> true

status.staged.includes("big.bin")
=> false
```

```ts cleanup
await box.cleanup();
```

## stageAll stages deletions, and still catches an oversized file alongside one

The size check asks git for each staged path's blob. A staged *deletion* has no
blob, so it answers "missing" — and that must be a skip, not a failure: a
deletion is not "adding a big file". The case is worth pinning because the
check is batched into one `git cat-file --batch-check` call, where a thrown
error would abandon the whole check and let a genuinely oversized file through
whenever a deletion happened to be staged in the same sweep.

```ts
const dbox = await makeTmpBox({ git: true });
await writeFileFs(joinPath(dbox.root, "doomed.txt"), "delete me");
await stageAll(dbox.root);
await commit(dbox.root, { message: "add doomed.txt" });

// Now delete it, and add an oversized file in the same sweep.
await rmFs(joinPath(dbox.root, "doomed.txt"));
await writeFileFs(joinPath(dbox.root, "huge.bin"), Buffer.alloc(11 * 1024 * 1024, 1));

const _warn2 = console.warn; console.warn = () => {};
await stageAll(dbox.root);
console.warn = _warn2;

const dstatus = await getStatus(dbox.root);
// The deletion staged normally...
dstatus.staged.includes("doomed.txt")
=> true

// ...and the oversized file was still caught, which is what would break if a
// missing blob aborted the check.
dstatus.staged.includes("huge.bin")
=> false
```

```ts cleanup
await dbox.cleanup();
```

## isNothingToCommitError recognizes git's empty-commit message

When the box's own auto-commit (`git add -A`) wins the race, an explicit
`commit` exits non-zero with git's "nothing to commit" text — the same output
that leaked from the clerk 500. The detector recognizes it so callers can treat
it as success (the content IS committed) rather than an error, and leaves real
git failures alone.

```ts
isNothingToCommitError(new Error("On branch main\nnothing to commit, working tree clean\n"))
=> true

isNothingToCommitError(new Error("fatal: not a git repository (or any of the parent directories): .git"))
=> false
```

## stageAndCommitPaths — stage + path-scoped commit with race tolerance

`stageAndCommitPaths` stages exactly `paths` and commits only them (via
`commitPaths`), so a concurrent mutator's unrelated staged files can't be
co-committed under this caller's attribution. It returns the new commit hash.

```ts
const box = await makeTmpBox({ git: true });
await box.write("note.card", "hi");
const hash = await stageAndCommitPaths(box.root, {
  paths: ["note.card"],
  message: "Add note",
  trailers: { "Created-By": "clerk-api" },
});
print(`hash length: ${hash?.length}`);

const log = await getLog(box.root);
print(`subject: ${log[0].subject}`);
print(`Created-By: ${log[0].trailers?.["Created-By"]}`);
=>
hash length: 40
subject: Add note
Created-By: clerk-api
```

Only the named paths land — a concurrently-staged unrelated file is left
staged, NOT swept into this commit:

```ts continue
await box.write("scoped.card", "mine");
await box.write("other.card", "someone else's staged work");
await stageFiles(box.root, ["other.card"]);

await stageAndCommitPaths(box.root, { paths: ["scoped.card"], message: "Add scoped" });
const committed = await getCommitDiff(box.root, await getHead(box.root));
print(`scoped in commit: ${committed.includes("scoped.card")}`);
print(`other in commit: ${committed.includes("other.card")}`);
const status = await getStatus(box.root);
// getStatus paths are repo-root-relative (repo root = package root).
print(`other still staged: ${status.staged.includes("other.card")}`);
=>
scoped in commit: true
other in commit: false
other still staged: true
```

Fast path — nothing to commit returns `null` instead of throwing. Both an
already-committed path (no changes) and an empty path list land here:

```ts continue
JSON.stringify(await stageAndCommitPaths(box.root, { paths: ["scoped.card"], message: "no-op" }))
=> null

JSON.stringify(await stageAndCommitPaths(box.root, { paths: [], message: "empty" }))
=> null
```

A rename commits both halves. Rename detection must not collapse the staged
path list to only the destination and leave the source deletion behind.

```ts continue
await box.write("before.card", "move me");
await box.commitAll("add before");
await rename(box.path("before.card"), box.path("after.card"));
await stageAndCommitPaths(box.root, { paths: ["before.card", "after.card"], message: "Move card" });
const renameStatus = await getStatus(box.root);
const renameDiff = await getCommitDiff(box.root, await getHead(box.root));
print(`clean: ${renameStatus.clean}`);
print(`before in commit: ${renameDiff.includes("before.card")}`);
print(`after in commit: ${renameDiff.includes("after.card")}`);
=>
clean: true
before in commit: true
after in commit: true
```

```ts cleanup
await box.cleanup();
```
