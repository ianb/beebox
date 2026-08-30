# Box Git Lock

`withBoxGitLock(dir, fn)` serializes our writers on a box's repo-wide git
index. It is reentrant by async context, queues same-process callers in FIFO
order, and — the property that keeps it from ever wedging a box — logs loudly
and runs `fn` unserialized rather than failing when it cannot acquire the lock.

```ts setup
import { withBoxGitLock, activeBoxGitLockCount, BOX_GIT_LOCK_WAIT_MS } from "../../src/lib/git-lock.js";
import { acquireLock, releaseLock, LockHeldError } from "../../src/lib/file-lock.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { getStatus } from "../../src/lib/git.js";
import { join } from "node:path";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
```

## The lock is keyed on the git directory, not the caller's path

A shapeVersion-2 box is one repository whose git directory sits at the package
root, while the operational box root is `content/`. Different modules pass
different directories for the same index — `docs-gen` commits at the package
root, everything else at `boxRoot` — so keying on the caller's path would give
one index two locks.

Both spellings resolve to the same lock, which is why one blocks the other:

```ts
const box = await makeTmpBox({ git: true });

const order: string[] = [];
const outer = withBoxGitLock(box.packageRoot, async () => {
  order.push("packageRoot-enter");
  await delay(50);
  order.push("packageRoot-exit");
});
await delay(10);
const inner = withBoxGitLock(box.root, async () => {
  order.push("boxRoot");
});
await Promise.all([outer, inner]);
order.join(" ")
=> packageRoot-enter packageRoot-exit boxRoot
```

The lock file itself lives inside the git directory, so holding it leaves
nothing behind in the working tree:

```ts continue
await withBoxGitLock(box.root, async () => "held");
(await getStatus(box.packageRoot)).clean
=> true
```

```ts cleanup
await box.cleanup();
```

## Reentrancy passes through instead of deadlocking

`proper-lockfile` is not reentrant, so a nested acquisition would stall until
the wait budget expired. `stageAndCommitPaths` holds a span and calls
`stageFiles` and `commitPaths` inside it, so nesting is ordinary composition
here, not a bug — unlike `withCardLock`, which throws on the same situation.

A nested call runs immediately, on the same held lock:

```ts
const box = await makeTmpBox({ git: true });

const trace: string[] = [];
await withBoxGitLock(box.root, async () => {
  trace.push("outer");
  await withBoxGitLock(box.root, async () => {
    trace.push("inner");
    await withBoxGitLock(box.root, async () => {
      trace.push("innermost");
    });
  });
});
trace.join(" ")
=> outer inner innermost
```

Nesting is checked before the in-process queue. A nested call that enqueued
would wait behind its own ancestor — an unbounded deadlock rather than a
bounded one — so this finishing at all is the assertion:

```ts continue
let queueDepthInsideNested = -1;
await withBoxGitLock(box.root, async () => {
  await withBoxGitLock(box.root, async () => {
    queueDepthInsideNested = activeBoxGitLockCount();
  });
});
queueDepthInsideNested
=> 1
```

The queue drains once the outer span completes:

```ts continue
activeBoxGitLockCount()
=> 0
```

```ts cleanup
await box.cleanup();
```

## Same-process callers queue in FIFO order without polling

Two concurrent tasks in one `bbx serve` would otherwise both poll the file lock
at 100ms. The in-process chain runs them one at a time, in arrival order.

```ts
const box = await makeTmpBox({ git: true });

const log: string[] = [];
const tasks = ["a", "b", "c"].map((name) =>
  withBoxGitLock(box.root, async () => {
    log.push(`${name}-enter`);
    await delay(20);
    log.push(`${name}-exit`);
  }),
);
await Promise.all(tasks);
log.join(" ")
=> a-enter a-exit b-enter b-exit c-enter c-exit
```

A caller that throws does not poison the queue behind it:

```ts continue
const results: string[] = [];
const failing = withBoxGitLock(box.root, async () => {
  throw new LockHeldError({ pid: 1, hostname: "test", acquiredAt: "now", metadata: {} });
});
const following = withBoxGitLock(box.root, async () => {
  results.push("ran anyway");
});
await failing.catch((e) => { results.push(`caught ${e.name}`); });
await following;
results.join(" | ")
=> caught LockHeldError | ran anyway
```

That case also proves `fn` runs exactly once. The acquire path and `fn` can
both reject with `LockHeldError`, and without distinguishing them a throwing
`fn` would be retried unserialized:

```ts continue
let calls = 0;
await withBoxGitLock(box.root, async () => {
  calls += 1;
  throw new LockHeldError({ pid: 1, hostname: "test", acquiredAt: "now", metadata: {} });
}).catch(() => {});
calls
=> 1
```

```ts cleanup
await box.cleanup();
```

## A directory outside a repository runs unlocked

There is no index to serialize on, and inventing an error here would hide
whatever git actually reports.

```ts
const box = await makeTmpBox();

await withBoxGitLock(box.root, async () => "ran");
=> ran
```

```ts cleanup
await box.cleanup();
```

## When the lock cannot be acquired, `fn` runs anyway — loudly

This is the property that keeps the lock from ever wedging a box. A SIGKILLed
holder's guard directory only becomes reclaimable after the 5-minute stale
window, so failing hard at the wait budget would turn one crashed process into
minutes of failing writers — a worse failure than the one being fixed. Instead
the caller warns and proceeds unserialized, which is the behaviour that
predates the lock.

Take the lock as another owner would, then contend for it. The wait budget is
shortened via the test-only `BBX_BOX_GIT_LOCK_WAIT_MS` override so the test does
not spend a real minute expiring it.

```ts
const box = await makeTmpBox({ git: true });
process.env["BBX_BOX_GIT_LOCK_WAIT_MS"] = "300";
const errors: string[] = [];
const realError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(" ")); };

// Hold the lock as an unrelated owner would, then release our in-process
// record of it so `withBoxGitLock` sees a foreign holder.
const gitDir = join(box.packageRoot, ".git");
const lockPath = join(gitDir, "beebox-index.lock");
await acquireLock(lockPath, { purpose: "doctest-foreign-holder" });

const result = await withBoxGitLock(box.root, async () => "ran unserialized");
console.error = realError;
result
=> ran unserialized
```

The degradation is never silent — it names the holder and says plainly that the
operation was not serialized:

```ts continue
errors.length
=> 1

errors[0].includes("Proceeding WITHOUT the lock")
=> true

errors[0].includes(`pid ${process.pid}`)
=> true
```

The shipped budget is a minute — long enough that only a writer outside our
control reaches it:

```ts continue
await releaseLock(lockPath);
delete process.env["BBX_BOX_GIT_LOCK_WAIT_MS"];
BOX_GIT_LOCK_WAIT_MS
=> 60000
```

```ts cleanup
await box.cleanup();
```
