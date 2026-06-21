# File Lock

Machine-local PID-based file lock. Liveness is checked via `process.kill(pid, 0)`
and a boot-epoch comparison; dead holders (crashed processes, post-reboot stale
files) are reclaimed automatically.

```ts setup
import {
  acquireLock,
  releaseLock,
  inspectLock,
  forceAcquireLock,
  scanLocks,
  LockHeldError,
} from "../src/lib/file-lock.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { join } from "node:path";
```

## acquireLock / releaseLock

### Acquire creates the lock file with our metadata

```ts
const box = await makeTmpBox();
const path = join(box.root, "test.lock");
const holder = await acquireLock(path, { triggeredBy: "manual" });
print(`pid: ${holder.pid === process.pid}`);
print(`hostname: ${holder.hostname === os.hostname()}`);
print(`triggeredBy: ${holder.metadata.triggeredBy}`);
print(`file exists: ${await fs.access(path).then(() => true).catch(() => false)}`);
=>
pid: true
hostname: true
triggeredBy: manual
file exists: true
```

```ts cleanup
await releaseLock(path);
await box.cleanup();
```

### Release removes the file

```ts
const box = await makeTmpBox();
const path = join(box.root, "test.lock");
await acquireLock(path, {});
await releaseLock(path);
await fs.access(path).then(() => "exists").catch(() => "gone")
=> gone
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

### Stale lock with dead PID is reclaimed

```ts
const box = await makeTmpBox();
const path = join(box.root, "test.lock");

// Write a fake holder pointing to a PID that doesn't exist.
const deadHolder = {
  pid: 999999999,
  bootEpochSeconds: Math.floor(Date.now() / 1000 - os.uptime()),
  hostname: os.hostname(),
  acquiredAt: new Date().toISOString(),
  metadata: { who: "ghost" },
};
await fs.writeFile(path, JSON.stringify(deadHolder, null, 2) + "\n");

// We should be able to acquire over it.
const holder = await acquireLock(path, { who: "us" });
holder.metadata.who
=> us
```

```ts cleanup
await releaseLock(path);
await box.cleanup();
```

### Lock from a previous boot is reclaimed

```ts
const box = await makeTmpBox();
const path = join(box.root, "test.lock");

// Boot epoch from "before reboot" — well outside the tolerance window.
const oldHolder = {
  pid: process.pid,  // even if PID matches, mismatched boot means dead
  bootEpochSeconds: Math.floor(Date.now() / 1000 - os.uptime()) - 86400,
  hostname: os.hostname(),
  acquiredAt: new Date(Date.now() - 86400000).toISOString(),
  metadata: {},
};
await fs.writeFile(path, JSON.stringify(oldHolder, null, 2) + "\n");

const holder = await acquireLock(path, { fresh: true });
holder.metadata.fresh
=> true
```

```ts cleanup
await releaseLock(path);
await box.cleanup();
```

### Malformed lock file is reclaimed

```ts
const box = await makeTmpBox();
const path = join(box.root, "test.lock");
await fs.writeFile(path, "not json {{{");

const holder = await acquireLock(path, {});
holder.pid === process.pid
=> true
```

```ts cleanup
await releaseLock(path);
await box.cleanup();
```

### Empty lock file is reclaimed

```ts
const box = await makeTmpBox();
const path = join(box.root, "test.lock");
await fs.writeFile(path, "");

const holder = await acquireLock(path, {});
holder.pid === process.pid
=> true
```

```ts cleanup
await releaseLock(path);
await box.cleanup();
```

## Cross-host safety

### Lock from a different hostname is NOT reclaimed

```ts
const box = await makeTmpBox();
const path = join(box.root, "test.lock");
const foreignHolder = {
  pid: 999999999,
  bootEpochSeconds: Math.floor(Date.now() / 1000 - os.uptime()),
  hostname: "some-other-machine",
  acquiredAt: new Date().toISOString(),
  metadata: {},
};
await fs.writeFile(path, JSON.stringify(foreignHolder, null, 2) + "\n");

const caught = await acquireLock(path, {}).then(() => null, (e) => e);
caught instanceof LockHeldError
=> true
```

```ts cleanup
await box.cleanup();
```

## releaseLock ownership

### Release does not touch a lock owned by a different process

```ts
const box = await makeTmpBox();
const path = join(box.root, "test.lock");
const otherHolder = {
  pid: process.pid + 1,
  bootEpochSeconds: Math.floor(Date.now() / 1000 - os.uptime()),
  hostname: os.hostname(),
  acquiredAt: new Date().toISOString(),
  metadata: {},
};
await fs.writeFile(path, JSON.stringify(otherHolder, null, 2) + "\n");
await releaseLock(path);
await fs.access(path).then(() => "still here").catch(() => "deleted")
=> still here
```

```ts cleanup
await fs.unlink(path);
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

### Cleans up dead lock and returns null

```ts
const box = await makeTmpBox();
const path = join(box.root, "test.lock");
await fs.writeFile(path, JSON.stringify({
  pid: 999999999,
  bootEpochSeconds: Math.floor(Date.now() / 1000 - os.uptime()),
  hostname: os.hostname(),
  acquiredAt: new Date().toISOString(),
  metadata: {},
}) + "\n");

const result = await inspectLock(path);
const stillThere = await fs.access(path).then(() => true).catch(() => false);
print(`result: ${result}`);
print(`file: ${stillThere ? "exists" : "gone"}`);
=>
result: null
file: gone
```

```ts cleanup
await box.cleanup();
```

## forceAcquireLock

### Steals a held lock

```ts
const box = await makeTmpBox();
const path = join(box.root, "test.lock");
const otherHolder = {
  pid: process.pid + 1,
  bootEpochSeconds: Math.floor(Date.now() / 1000 - os.uptime()),
  hostname: os.hostname(),
  acquiredAt: new Date().toISOString(),
  metadata: { from: "victim" },
};
await fs.writeFile(path, JSON.stringify(otherHolder, null, 2) + "\n");

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

### Cleans up dead locks during scan

```ts
const box = await makeTmpBox();
const dir = join(box.root, "locks");
await fs.mkdir(dir, { recursive: true });
await acquireLock(join(dir, "alive.lock"), {});
await fs.writeFile(join(dir, "dead.lock"), JSON.stringify({
  pid: 999999999,
  bootEpochSeconds: Math.floor(Date.now() / 1000 - os.uptime()),
  hostname: os.hostname(),
  acquiredAt: new Date().toISOString(),
  metadata: {},
}) + "\n");

const map = await scanLocks(dir, ".lock");
const deadStillThere = await fs.access(join(dir, "dead.lock")).then(() => true).catch(() => false);
print(`size: ${map.size}`);
print(`alive present: ${map.has("alive")}`);
print(`dead file: ${deadStillThere ? "exists" : "gone"}`);
=>
size: 1
alive present: true
dead file: gone
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
