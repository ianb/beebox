# Git Utilities

Tests for the git helper functions in `src/lib/git.ts`.

```ts setup
import {
  initRepo, isRepo, getStatus, stageFiles, stageAll,
  commit, getLog, getLogPaginated, getDiff, getCommitDiff,
  getCurrentBranch, hasCommits, createBranch, checkoutBranch,
  createTag, deleteTag, getHead, clean, isNothingToCommitError,
} from "../../../src/lib/git.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
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
import { writeFile as writeFileFs } from "node:fs/promises";
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
status.staged.includes("small.txt")
=> true

status.staged.includes("big.bin")
=> false
```

```ts cleanup
await box.cleanup();
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
