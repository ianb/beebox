# File Lock

Machine-local cross-process file lock, implemented on `proper-lockfile`.
Mutual exclusion is a single atomic `mkdir` of a guard directory
(`<path>.guard`); a diagnostic sidecar file at `<path>` carries the holder's
identity but never participates in the acquire decision. Stale/crashed holders
are reclaimed via `proper-lockfile`'s mtime freshness (`stale` = 5 min), never
by an unconditional unlink-by-path.

```ts setup
import {
  acquireLock,
  releaseLock,
  inspectLock,
  forceAcquireLock,
  scanLocks,
  LockHeldError,
} from "../../src/lib/file-lock.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { join } from "node:path";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The stale window in file-lock.ts is 5 min; "well past stale" backdates a
// guard dir's mtime beyond it to simulate a crashed holder.
const STALE_MS = 5 * 60 * 1000;
function backdatedPast() {
  return new Date(Date.now() - STALE_MS - 60 * 1000);
}

// Write a diagnostic sidecar as if another process had published it.
function foreignSidecar(who, pid) {
  return JSON.stringify({
    pid,
    hostname: os.hostname(),
    acquiredAt: new Date().toISOString(),
    metadata: { who },
  }) + "\n";
}
```

## acquireLock / releaseLock

### Acquire creates the guard dir + diagnostic sidecar with our metadata

```ts
const box = await makeTmpBox();
const path = join(box.root, "test.lock");
const holder = await acquireLock(path, { triggeredBy: "manual" });
print(`pid: ${holder.pid === process.pid}`);
print(`hostname: ${holder.hostname === os.hostname()}`);
print(`triggeredBy: ${holder.metadata.triggeredBy}`);
print(`guard dir: ${await fs.stat(path + ".guard").then((s) => s.isDirectory()).catch(() => false)}`);
print(`sidecar file: ${await fs.access(path).then(() => true).catch(() => false)}`);
=>
pid: true
hostname: true
triggeredBy: manual
guard dir: true
sidecar file: true
```

```ts cleanup
await releaseLock(path);
await box.cleanup();
```

### Release removes both the guard dir and the sidecar

```ts
const box = await makeTmpBox();
const path = join(box.root, "test.lock");
await acquireLock(path, {});
await releaseLock(path);
print(`guard: ${await fs.access(path + ".guard").then(() => "exists").catch(() => "gone")}`);
print(`sidecar: ${await fs.access(path).then(() => "exists").catch(() => "gone")}`);
=>
guard: gone
sidecar: gone
```

```ts cleanup
await box.cleanup();
```

### Release is idempotent

Releasing when not held, releasing twice — both fine.

```ts
const box = await makeTmpBox();
const path = join(box.root, "test.lock");
await releaseLock(path);
await acquireLock(path, {});
await releaseLock(path);
await releaseLock(path);
"ok"
=> ok
```

```ts cleanup
await box.cleanup();
```

## Concurrency

### Acquiring a held lock throws LockHeldError

```ts
const box = await makeTmpBox();
const path = join(box.root, "test.lock");
await acquireLock(path, { who: "first" });
const caught = await acquireLock(path, { who: "second" }).then(() => null, (e) => e);
print(`error type: ${caught instanceof LockHeldError}`);
print(`who: ${caught.holder.metadata.who}`);
=>
error type: true
who: first
```

```ts cleanup
await releaseLock(path);
await box.cleanup();
```

### A live foreign holder (guard dir owned by another process) is not stolen

A fresh guard directory with no in-process release is exactly what another live
process's `proper-lockfile` would leave. We must see it as held.

```ts
const box = await makeTmpBox();
const path = join(box.root, "test.lock");
await fs.mkdir(path + ".guard");
await fs.writeFile(path, foreignSidecar("other-proc", 4242));

const caught = await acquireLock(path, { who: "us" }).then(() => null, (e) => e);
print(`held: ${caught instanceof LockHeldError}`);
print(`holder pid: ${caught.holder.pid}`);
print(`holder who: ${caught.holder.metadata.who}`);
=>
held: true
holder pid: 4242
holder who: other-proc
```

```ts cleanup
await box.cleanup();
```

### Many parallel acquisitions: exactly one wins, the rest see LockHeldError

The guard-dir `mkdir` is atomic, so contention on one path can never
double-acquire. The winner stays alive holding the lock; every other attempt
rejects with `LockHeldError`.

```ts
const box = await makeTmpBox();
const path = join(box.root, "test.lock");
const results = await Promise.allSettled(
  Array.from({ length: 40 }, (_unused, i) => acquireLock(path, { who: i })),
);
const winners = results.filter((r) => r.status === "fulfilled");
const losers = results.filter((r) => r.status === "rejected");
print(`winners: ${winners.length}`);
print(`losers: ${losers.length}`);
print(`all losers LockHeldError: ${losers.every((r) => r.reason instanceof LockHeldError)}`);
=>
winners: 1
losers: 39
all losers LockHeldError: true
```

```ts cleanup
await releaseLock(path);
await box.cleanup();
```

### The reclaim/release handoff yields exactly one holder (the race the old code lost)

This is the scenario the previous home-grown lock failed: a holder releases
while contenders are mid-retry, and the reclaim must hand the lock to *exactly
one* of them — never two. The winner holds; the losers keep seeing
`LockHeldError` until they give up. If the release-then-reacquire path could
double-acquire, more than one contender would have gotten in.

```ts
const box = await makeTmpBox();
const path = join(box.root, "test.lock");
await acquireLock(path, { who: "A" });

let acquiredCount = 0;
const contend = async (id) => {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await acquireLock(path, { who: id });
      acquiredCount++;
      return; // won it — HOLD (do not release), so no one else may acquire
    } catch (e) {
      if (!(e instanceof LockHeldError)) throw e;
      await delay(15);
    }
  }
};

const contenders = Array.from({ length: 5 }, (_unused, i) => contend(`c${i}`));
await delay(60); // let them all bounce off A's held lock
await releaseLock(path); // A steps aside — exactly one contender may now win
await Promise.all(contenders);
acquiredCount
=> 1
```

```ts cleanup
await releaseLock(path); // release whichever contender is now holding `path`
await box.cleanup();
```

## Stale / crash recovery

### A crashed holder (stale guard mtime) is reclaimed on the next acquire

A SIGKILL'd process leaves its guard directory behind with a frozen mtime.
Once that mtime is older than the stale window, the next acquirer reclaims it —
no PID liveness, no unlink-by-path, just `proper-lockfile`'s mtime steal.

```ts
const box = await makeTmpBox();
const path = join(box.root, "test.lock");
const guard = path + ".guard";
await fs.mkdir(guard);
const past = backdatedPast();
await fs.utimes(guard, past, past);
await fs.writeFile(path, foreignSidecar("ghost", 999999));

const holder = await acquireLock(path, { who: "us" });
holder.metadata.who
=> us
```

```ts cleanup
await releaseLock(path);
await box.cleanup();
```

### releaseLock never deletes a foreign holder's lock

Releasing a path this process never acquired (no recorded release) is a no-op —
it can never remove another process's guard directory.

```ts
const box = await makeTmpBox();
const path = join(box.root, "test.lock");
await fs.mkdir(path + ".guard");
await fs.writeFile(path, foreignSidecar("other-proc", 4242));

await releaseLock(path);
print(`guard survives: ${await fs.access(path + ".guard").then(() => true).catch(() => false)}`);
print(`sidecar survives: ${await fs.access(path).then(() => true).catch(() => false)}`);
=>
guard survives: true
sidecar survives: true
```

```ts cleanup
await box.cleanup();
```

## inspectLock

### Returns null when not held

```ts
const box = await makeTmpBox();
const path = join(box.root, "test.lock");
await inspectLock(path)
=> null
```

```ts cleanup
await box.cleanup();
```

### Returns the holder when held

```ts
const box = await makeTmpBox();
const path = join(box.root, "test.lock");
await acquireLock(path, { tag: "abc" });
const info = await inspectLock(path);
info.metadata.tag
=> abc
```

```ts cleanup
await releaseLock(path);
await box.cleanup();
```

### A stale (crashed) holder reads as not held

`inspectLock` uses `proper-lockfile`'s `.check()`, which treats a guard whose
mtime is past the stale window as not held.

```ts
const box = await makeTmpBox();
const path = join(box.root, "test.lock");
const guard = path + ".guard";
await fs.mkdir(guard);
const past = backdatedPast();
await fs.utimes(guard, past, past);
await fs.writeFile(path, foreignSidecar("ghost", 999999));

await inspectLock(path)
=> null
```

```ts cleanup
await box.cleanup();
```

## forceAcquireLock

### Steals a held lock

```ts
const box = await makeTmpBox();
const path = join(box.root, "test.lock");
await fs.mkdir(path + ".guard");
await fs.writeFile(path, foreignSidecar("victim", 4242));

const stolen = await forceAcquireLock(path, { from: "thief" });
stolen.metadata.from
=> thief
```

```ts cleanup
await releaseLock(path);
await box.cleanup();
```

## scanLocks

### Returns empty map when directory missing

```ts
const box = await makeTmpBox();
const map = await scanLocks(join(box.root, "nope"), ".lock");
map.size
=> 0
```

```ts cleanup
await box.cleanup();
```

### Returns live locks keyed by name (suffix stripped)

```ts
const box = await makeTmpBox();
const dir = join(box.root, "locks");
await fs.mkdir(dir, { recursive: true });
await acquireLock(join(dir, "alpha.lock"), { who: "a" });
await acquireLock(join(dir, "beta.lock"), { who: "b" });

const map = await scanLocks(dir, ".lock");
print(`size: ${map.size}`);
print(`alpha: ${map.get("alpha").metadata.who}`);
print(`beta: ${map.get("beta").metadata.who}`);
=>
size: 2
alpha: a
beta: b
```

```ts cleanup
await releaseLock(join(dir, "alpha.lock"));
await releaseLock(join(dir, "beta.lock"));
await box.cleanup();
```

### Reclaims dead (stale) locks during scan

A live lock is reported; a crashed lock (stale guard mtime) is reclaimed — its
guard dir and sidecar are removed — and excluded from the result. The reclaim
happens while atomically holding the lock, so it can never delete a live
holder's guard.

```ts
const box = await makeTmpBox();
const dir = join(box.root, "locks");
await fs.mkdir(dir, { recursive: true });
await acquireLock(join(dir, "alive.lock"), { who: "alive" });

const deadPath = join(dir, "dead.lock");
await fs.mkdir(deadPath + ".guard");
const past = backdatedPast();
await fs.utimes(deadPath + ".guard", past, past);
await fs.writeFile(deadPath, foreignSidecar("ghost", 999999));

const map = await scanLocks(dir, ".lock");
const deadGuardGone = await fs.access(deadPath + ".guard").then(() => false).catch(() => true);
const deadSidecarGone = await fs.access(deadPath).then(() => false).catch(() => true);
print(`size: ${map.size}`);
print(`alive present: ${map.has("alive")}`);
print(`dead guard: ${deadGuardGone ? "gone" : "exists"}`);
print(`dead sidecar: ${deadSidecarGone ? "gone" : "exists"}`);
=>
size: 1
alive present: true
dead guard: gone
dead sidecar: gone
```

```ts cleanup
await releaseLock(join(dir, "alive.lock"));
await box.cleanup();
```

### Ignores files without the suffix

```ts
const box = await makeTmpBox();
const dir = join(box.root, "locks");
await fs.mkdir(dir, { recursive: true });
await acquireLock(join(dir, "real.lock"), {});
await fs.writeFile(join(dir, "real.json"), `{"pid":${process.pid}}`);

const map = await scanLocks(dir, ".lock");
map.size
=> 1
```

```ts cleanup
await releaseLock(join(dir, "real.lock"));
await box.cleanup();
```
