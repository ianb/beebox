# Git Utilities

Tests for the git helper functions in `src/cli/lib/git.ts`.

```ts setup
import {
  initRepo, isRepo, getStatus, stageFiles, stageAll,
  commit, getLog, getLogPaginated, getDiff, getCommitDiff,
  getCurrentBranch, hasCommits, createBranch, checkoutBranch,
  createTag, deleteTag, getHead, clean,
} from "../src/cli/lib/git.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
```

## Repository detection

```
const box = await makeTmpBox();
await isRepo(box.root)
=> false
```

``` continue
await initRepo(box.root);
await isRepo(box.root)
=> true
```

``` cleanup
await box.cleanup();
```

## Initial state

A freshly initialized repo has no commits and a clean status:

```
const box = await makeTmpBox({ git: true });
await hasCommits(box.root)
=> true

await getCurrentBranch(box.root)
=> main
```

``` continue
const status = await getStatus(box.root);
status.clean
=> true

status.staged.length
=> 0
```

``` cleanup
await box.cleanup();
```

## Staging and status

```
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

``` cleanup
await box.cleanup();
```

## Stage all

```
const box = await makeTmpBox({ git: true });
await box.write("a.txt", "a");
await box.write("b.txt", "b");
await stageAll(box.root);
const status = await getStatus(box.root);
status.staged.length
=> 2
```

``` cleanup
await box.cleanup();
```

## Commit and log

```
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

``` cleanup
await box.cleanup();
```

## Commit with trailers

```
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

``` cleanup
await box.cleanup();
```

## getLogPaginated with multi-value trailers

```
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

``` continue
// Pagination: offset skips entries
const skipped = await getLogPaginated({ boxRoot: box.root, offset: 1 });
skipped[0].subject
=> init
```

``` cleanup
await box.cleanup();
```

## getDiff

```
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

``` continue
// Staged diff
await stageAll(box.root);
const stagedDiff = await getDiff(box.root, true);
stagedDiff.includes("+modified")
=> true
```

``` cleanup
await box.cleanup();
```

## getCommitDiff

```
const box = await makeTmpBox({ git: true });
await box.write("file.txt", "content");
await stageAll(box.root);
const hash = await commit(box.root, { message: "Add file" });

const diff = await getCommitDiff(box.root, hash);
diff.includes("+content")
=> true
```

``` cleanup
await box.cleanup();
```

## getHead

```
const box = await makeTmpBox({ git: true });
const head = await getHead(box.root);
head.length
=> 40
```

``` cleanup
await box.cleanup();
```

## Branches

```
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

``` cleanup
await box.cleanup();
```

## Tags

```
const box = await makeTmpBox({ git: true });
await createTag(box.root, "v1.0");
// Tag exists — getHead should still work
const head = await getHead(box.root);
head.length
=> 40
```

``` continue
// Delete the tag (no error)
await deleteTag(box.root, "v1.0");
"deleted"
=> deleted
```

``` cleanup
await box.cleanup();
```

## Clean removes untracked files

```
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

``` cleanup
await box.cleanup();
```

## Empty log on repo with no matching commits

```
const box = await makeTmpBox({ git: true });
const log = await getLog(box.root, 0);
log.length
=> 0
```

``` cleanup
await box.cleanup();
```
