# File Lock

Machine-local cross-process file lock, implemented on `proper-lockfile`.
Mutual exclusion is a single atomic `mkdir` of a guard directory
(`<path>.guard`); a diagnostic sidecar file at `<path>` carries the holder's
identity but never participates in the acquire decision. Stale/crashed holders
are reclaimed via `proper-lockfile`'s mtime freshness — 5 min by default, 15 s
for request-scoped locks — never by an unconditional unlink-by-path.

```ts setup
import {
  acquireLock,
  releaseLock,
  inspectLock,
  forceAcquireLock,
  scanLocks,
  withFileLock,
  requestScopedLock,
  LOCK_STALE_MS,
  LockHeldError,
} from "../../src/lib/file-lock.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { join } from "node:path";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The default profile's stale window is 5 min; "well past stale" backdates a
// guard dir's mtime beyond it to simulate a crashed holder.
function backdatedPast() {
  return new Date(Date.now() - LOCK_STALE_MS.default - 60 * 1000);
}

const PACKAGE_ROOT = join(import.meta.dirname, "../..");
const CHILD_SCRIPT = join(PACKAGE_ROOT, "test/helpers/file-lock-child.ts");

// Spawn a real child process that takes `lockPath` (request profile) and holds
// it, then SIGKILL it mid-hold — a genuine crashed holder, guard dir and all.
async function crashedHolder(lockPath) {
  const child = spawn(process.execPath, ["--import", "tsx", CHILD_SCRIPT, lockPath], {
    cwd: PACKAGE_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => { if (String(chunk).includes("acquired")) resolve(); });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`child exited early (${code}): ${stderr}`)));
  });
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));
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

## Stale profiles

Request-scoped locks (mobile device store, local users, connector token
stores, ...) declare the `request` profile via `requestScopedLock(path)`, which
shortens the stale window from 5 min to 15 s so a crashed holder can't wedge an
HTTP path for minutes. Locks passed as a plain path keep the default profile.

### The profile constants

A non-sleeping check on the real constants: the request profile must stay
inside the stated post-crash recovery SLO (≤ 30 s), and the default profile
stays at 5 min (sized for `cb tick`'s long-held script locks).

```ts
print(`request: ${LOCK_STALE_MS.request}`);
print(`request within SLO: ${LOCK_STALE_MS.request > 0 && LOCK_STALE_MS.request <= 30_000}`);
print(`default: ${LOCK_STALE_MS.default}`);
=>
request: 15000
request within SLO: true
default: 300000
```

### A SIGKILL'd request-scoped holder recovers within the request stale window

A real child process takes the lock and is killed mid-hold, leaving its guard
directory behind. Immediately afterwards the lock still reads as held — callers
with a ~5 s retry budget fail *loud* rather than block, which is by design. Once
the request stale window has elapsed the next acquirer reclaims it.

Rather than sleeping 15 s, we backdate the dead holder's guard mtime to
simulate that much time passing — and check the same instant through both
profiles: the default profile (5 min) still sees a live holder, the request
profile reclaims.

```ts
const box = await makeTmpBox();
const lockPath = join(box.root, "devices.lock");
await crashedHolder(lockPath);

const justAfter = await acquireLock(requestScopedLock(lockPath), { who: "b" }).then(() => "acquired", (e) => e.name);
print(`immediately after crash: ${justAfter}`);

const aged = new Date(Date.now() - LOCK_STALE_MS.request - 1000);
await fs.utimes(lockPath + ".guard", aged, aged);

const asDefault = await acquireLock(lockPath, { who: "d" }).then(() => "acquired", (e) => e.name);
print(`default profile at +16s: ${asDefault}`);
const holder = await acquireLock(requestScopedLock(lockPath), { who: "recovered" });
print(`request profile at +16s: ${holder.metadata.who}`);
=>
immediately after crash: LockHeldError
default profile at +16s: LockHeldError
request profile at +16s: recovered
```

```ts cleanup
await releaseLock(lockPath);
await box.cleanup();
```

### Diagnostics use the same profile as acquisition

`inspectLock` must not disagree with `acquireLock` about staleness: at +16s the
same dead holder reads as gone through the request profile and as live through
the default one.

```ts
const box = await makeTmpBox();
const lockPath = join(box.root, "devices.lock");
await crashedHolder(lockPath);
const aged = new Date(Date.now() - LOCK_STALE_MS.request - 1000);
await fs.utimes(lockPath + ".guard", aged, aged);

print(`request profile: ${await inspectLock(requestScopedLock(lockPath))}`);
print(`default profile: ${(await inspectLock(lockPath)).metadata.purpose}`);
=>
request profile: null
default profile: file-lock-doctest-child
```

```ts cleanup
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
const map = await scanLocks(join(box.root, "nope"), { suffix: ".lock", profile: "default" });
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

const map = await scanLocks(dir, { suffix: ".lock", profile: "default" });
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

const map = await scanLocks(dir, { suffix: ".lock", profile: "default" });
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

const map = await scanLocks(dir, { suffix: ".lock", profile: "default" });
map.size
=> 1
```

```ts cleanup
await releaseLock(join(dir, "real.lock"));
await box.cleanup();
```

## withFileLock preserves a request-scoped target

The blocking wrapper accepts the same profiled target as the lower-level lock
operations, so short request-bound state updates retain their crash-recovery
window.

```ts
const box = await makeTmpBox();
const path = join(box.root, "request-state.lock");
const result = await withFileLock(
  { lockPath: requestScopedLock(path), metadata: { who: "wrapper" }, waitMs: 100 },
  async () => (await inspectLock(requestScopedLock(path)))?.metadata.who,
);
print(result);
print(await inspectLock(requestScopedLock(path)));
=>
wrapper
null
```

```ts cleanup
await box.cleanup();
```
