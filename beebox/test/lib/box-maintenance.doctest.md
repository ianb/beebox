# Shared admission closes before draining

A real child holds admitted work. Closing stops another root operation while
allowing a retained descendant to finish; maintenance starts only after both
release. A failed mutation leaves a record of unfinished maintenance, and the
box reopens the moment its owner is gone: a closure cannot outlive its owner.

```ts setup
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { acquireLock, forceAcquireLock, releaseLock } from "../../src/lib/file-lock.js";
import { acquireBoxWork, closeBoxMaintenance, acquireBoxMaintenance, acquireBoxStartup, withoutBoxWork, boxWorkEnvironment, boxMaintenanceStatus, boxWorkHolders } from "../../src/lib/box-maintenance.js";
const delay = () => new Promise((resolve) => setTimeout(resolve, 10));
```

```ts
const box = await makeTmpBox({ git: true });
const child = spawn(process.execPath, ["--import", "tsx", join(import.meta.dirname, "../helpers/box-maintenance-child.ts"), box.root], { stdio: ["pipe", "pipe", "inherit"] });
const [data] = await once(child.stdout, "data");
const env = JSON.parse(String(data));
let entered = false;
const pending = acquireBoxMaintenance(box.root, { reason: "fixture" }).then((value) => { entered = true; return value; });
while ((await boxMaintenanceStatus(box.root)) === null) await delay();
entered
=> false

await acquireBoxWork(box.root, { reason: "test" })
=> throws BoxMaintenanceError

const descendant = await acquireBoxWork(box.root, { reason: "test", inherited: env.BBX_BOX_WORK });
child.stdin.end("finish");
await once(child, "exit");
entered
=> false

await descendant.release();
const maintenance = await pending;
await maintenance.beginChanges();
await maintenance.release();
const record = await boxMaintenanceStatus(box.root);
`${record.phase} owner=${String(record.owner)} since=${typeof record.since}`
=> exclusive owner=null since=string

// Unfinished maintenance refuses nothing once its owner is gone.
const reopened = await acquireBoxWork(box.root, { reason: "test" });
await reopened.release();

// The next attempt closes the box again, keeps the record's start time, and
// clears the record when it completes.
const recovery = await acquireBoxMaintenance(box.root, { reason: "recover" });
const retried = await boxMaintenanceStatus(box.root);
`${retried.reason} owner=${retried.owner.reason} carried=${String(retried.since === record.since)}`
=> recover owner=recover carried=true

await acquireBoxWork(box.root, { reason: "test" })
=> throws BoxMaintenanceError

await recovery.held()
=> true

await recovery.beginChanges();
await recovery.complete();
await boxMaintenanceStatus(box.root)
=> null

await recovery.held()
=> false

const work = await acquireBoxWork(box.root, { reason: "test" });
await acquireBoxMaintenance(box.root, { reason: "timeout", drainMs: 0 })
=> throws BoxMaintenanceError

await boxMaintenanceStatus(box.root)
=> null

await work.release();

// A second owner is refused by name, not with a lock stack trace.
const owner = await closeBoxMaintenance(box.root, { reason: "deployment" });
const refused = await acquireBoxMaintenance(box.root, { reason: "migration" }).then(() => "unexpected", (error) => `${error.name}: ${error.message}; holder=${error.holder.reason}`);
await owner.release();
refused.replace(/\(pid \d+, since \S+\)/u, "(pid <n>, since <time>)")
=> BoxMaintenanceError: Box is closed for deployment (pid <n>, since <time>); holder=deployment

// Independently owned CLI actions reject a parent's inherited permission
// immediately, rather than closing admission and waiting for themselves.
const parentWork = await acquireBoxWork(box.root, { reason: "test" });
const savedPermission = process.env.BBX_BOX_WORK;
process.env.BBX_BOX_WORK = parentWork.run(boxWorkEnvironment).BBX_BOX_WORK;
const nestedFailure = await acquireBoxMaintenance(box.root, { reason: "nested CLI", drainMs: 0 }).then(() => "unexpected", (error) => error.message);
if (savedPermission === undefined) delete process.env.BBX_BOX_WORK; else process.env.BBX_BOX_WORK = savedPermission;
await parentWork.release();
nestedFailure
=> Nested maintenance is not allowed

// A prepared replacement may initialize, while ordinary work stays closed.
const replacement = await acquireBoxMaintenance(box.root, { reason: "replacement" });
await replacement.beginChanges();
await replacement.prepare();
await acquireBoxWork(box.root, { reason: "test", inherited: null })
=> throws BoxMaintenanceError

const startup = await acquireBoxStartup(box.root);
await replacement.complete()
=> throws InvariantError

await startup.release();
await replacement.release();
// The replacement's owner is gone, so startup is ordinary again.
const restarted = await acquireBoxStartup(box.root);
await restarted.release();

// A new owner republishes its id, allowing its delegated refresh.
const resumed = await acquireBoxMaintenance(box.root, { reason: "resume" });
const joined = await resumed.run(() => acquireBoxMaintenance(box.root, { reason: "docs", join: true }));
await joined.prepare();
await joined.release();
await joined.release();
(await boxMaintenanceStatus(box.root)).phase
=> ready

await resumed.run(() => withoutBoxWork(() => acquireBoxWork(box.root, { reason: "test" })))
=> throws BoxMaintenanceError

Object.keys(resumed.run(() => withoutBoxWork(boxWorkEnvironment)))
=> []

await resumed.complete();
await boxMaintenanceStatus(box.root)
=> null
```

```ts cleanup
child.kill();
await box.cleanup();
```

## A handle that lost its lock cannot touch the new owner's closure

A sleep past the lock's stale window lets another owner take the box. When the
old handle resumes, its phase writes and completion are refused, and its
release leaves the new owner's record alone.

```ts
const stolenBox = await makeTmpBox({ git: true });
const ownerLock = join(stolenBox.root, ".git/bbx-maintenance/owner.lock");
const sleeper = await acquireBoxMaintenance(stolenBox.root, { reason: "sleeper" });
await sleeper.beginChanges();
await forceAcquireLock(ownerLock, { id: "thief", reason: "thief" });
await sleeper.held()
=> false

await sleeper.beginChanges()
=> throws BoxMaintenanceError

await sleeper.complete()
=> throws BoxMaintenanceError

(await boxMaintenanceStatus(stolenBox.root)).owner.reason
=> thief

// Releasing the old handle leaves the record for the live owner to finish.
await sleeper.release();
(await boxMaintenanceStatus(stolenBox.root)).phase
=> exclusive
```

```ts cleanup
await releaseLock(ownerLock);
await sleeper.release();
await stolenBox.cleanup();
```

## Drain waits for lease publication, even with no published readers

The admission lock protects the gap before a writer publishes its sidecar.
An empty work directory is not sufficient evidence while that lock is held.

```ts
const barrierBox = await makeTmpBox({ git: true });
const admissionPath = join(barrierBox.root, ".git/bbx-maintenance/admission.lock");
await acquireLock(admissionPath, {});
const barrier = await closeBoxMaintenance(barrierBox.root, { reason: "publication barrier" });
const drained = barrier.drain().then(() => true);
await Promise.race([drained, new Promise((resolve) => setTimeout(() => resolve(false), 100))])
=> false

await releaseLock(admissionPath);
await drained
=> true

await barrier.complete();
await boxMaintenanceStatus(barrierBox.root)
=> null
```

```ts cleanup
await releaseLock(admissionPath);
await barrier.release();
await barrierBox.cleanup();
```

## A failed delegate leaves its controller's record behind

The outer handle only entered draining. Its delegate began mutation and failed;
releasing the controller must keep the persisted exclusive record, which the
next completed attempt clears.

```ts
const delegatedBox = await makeTmpBox({ git: true });
const controller = await acquireBoxMaintenance(delegatedBox.root, { reason: "outer" });
const delegate = await controller.run(() => acquireBoxMaintenance(delegatedBox.root, { reason: "delegate", join: true }));
await delegate.beginChanges();
await delegate.release();
await controller.release();
(await boxMaintenanceStatus(delegatedBox.root)).phase
=> exclusive

const admitted = await acquireBoxWork(delegatedBox.root, { reason: "test", inherited: null });
await admitted.release();
const repair = await acquireBoxMaintenance(delegatedBox.root, { reason: "recover delegate" });
await repair.complete();
await boxMaintenanceStatus(delegatedBox.root)
=> null
```

```ts cleanup
await controller.release();
await delegatedBox.cleanup();
```

## A surviving delegate blocks a new owner after its own exits

Joined work has its own retained lease. Replacing the controller cannot assume
that work stopped, and expired handles cannot publish phases for the new owner
nor prove they still hold the box.

```ts
const orphanBox = await makeTmpBox({ git: true });
const oldOwner = await acquireBoxMaintenance(orphanBox.root, { reason: "old owner" });
const orphan = await oldOwner.run(() => acquireBoxMaintenance(orphanBox.root, { reason: "surviving delegate", join: true }));
await orphan.beginChanges();
await oldOwner.release();
const newOwner = await closeBoxMaintenance(orphanBox.root, { reason: "new owner" });
const recoveredDrain = newOwner.drain().then(() => true);
await Promise.race([recoveredDrain, new Promise((resolve) => setTimeout(() => resolve(false), 100))])
=> false

await orphan.prepare()
=> throws BoxMaintenanceError

await orphan.held()
=> false

await orphan.release();
await recoveredDrain
=> true

await newOwner.prepare();
await oldOwner.beginChanges()
=> throws BoxMaintenanceError

await oldOwner.prepare()
=> throws BoxMaintenanceError

await oldOwner.release();
const currentPhase = await boxMaintenanceStatus(orphanBox.root);
JSON.stringify({ reason: currentPhase.reason, phase: currentPhase.phase })
=> {"reason":"new owner","phase":"ready"}

await newOwner.complete();
await boxMaintenanceStatus(orphanBox.root)
=> null
```

```ts cleanup
await orphan.release();
await oldOwner.release();
await newOwner.release();
await orphanBox.cleanup();
```

## Every admission names its holder, and a blocked drain reports them

The per-process lease sidecar lists the live reasons. Another process reads
them through `boxWorkHolders`; a drain that gives up names them in its error,
so a blocked maintenance never reports only its own reason.

```ts
const namedBox = await makeTmpBox({ git: true });
const workDir = join(namedBox.root, ".git/bbx-maintenance/work");
const sidecarHolders = async () => {
  const [name] = (await readdir(workDir)).filter((entry) => entry.endsWith(".lock"));
  return JSON.parse(await readFile(join(workDir, name), "utf8")).metadata.holders.map((holder) => holder.reason).join(", ");
};
const first = await acquireBoxWork(namedBox.root, { reason: "chat run one" });
await sidecarHolders()
=> chat run one

const second = await acquireBoxWork(namedBox.root, { reason: "POST /box/api/chat/send" });
await new Promise((resolve) => setTimeout(resolve, 400));
await sidecarHolders()
=> chat run one, POST /box/api/chat/send

await first.release();
await new Promise((resolve) => setTimeout(resolve, 400));
await sidecarHolders()
=> POST /box/api/chat/send

// This process's own leases are not "other work" to itself.
await boxWorkHolders(namedBox.root)
=> []

await second.release();
const namedChild = spawn(process.execPath, ["--import", "tsx", join(import.meta.dirname, "../helpers/box-maintenance-child.ts"), namedBox.root], { stdio: ["pipe", "pipe", "inherit"] });
await once(namedChild.stdout, "data");
(await boxWorkHolders(namedBox.root)).map((holder) => `${holder.reason} pid-matches=${String(holder.pid === namedChild.pid)}`).join(", ")
=> fixture child pid-matches=true

const blocked = await acquireBoxMaintenance(namedBox.root, { reason: "deployment", drainMs: 0 }).then(() => "unexpected", (error) => error.message);
blocked.replace(/since \S+ \(pid \d+\)/u, "since <time> (pid <n>)")
=> Timed out draining box work: deployment; held by fixture child since <time> (pid <n>)

namedChild.stdin.end("finish");
await once(namedChild, "exit");
await boxWorkHolders(namedBox.root)
=> []
```

```ts cleanup
namedChild.kill();
await namedBox.cleanup();
```
