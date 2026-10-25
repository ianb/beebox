// # Shared admission closes before draining
//
// A real child holds admitted work. Closing stops another root operation while
// allowing a retained descendant to finish; maintenance starts only after both
// release. A failed mutation leaves a record of unfinished maintenance, and the
// box reopens the moment its owner is gone: a closure cannot outlive its owner.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate, str, uuid } from "@ianbicking/tap-check/check";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readdir, readFile, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { acquireLock, forceAcquireLock, LOCK_STALE_MS, releaseLock, requestScopedLock } from "../../src/lib/file-lock.js";
import { lockGuardPath } from "../../src/shared/lock-guard.js";
import { acquireBoxWork, closeBoxMaintenance, acquireBoxMaintenance, acquireBoxStartup, withoutBoxWork, boxWorkEnvironment, boxMaintenanceStatus, boxWorkHolders } from "../../src/lib/box-maintenance/admission.js";

const delay = () => new Promise((resolve) => setTimeout(resolve, 10));

void test("line 19", async (t) => {
  t.teardown(async () => {
    try {
      child.kill();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const child = spawn(process.execPath, ["--import", "tsx", join(import.meta.dirname, "../helpers/box-maintenance-child.ts"), box.root], { stdio: ["pipe", "pipe", "inherit"] });
  const [data] = await once(child.stdout, "data");
  const env: { BBX_BOX_WORK: string } = JSON.parse(String(data));
  let entered = false;
  const pending = acquireBoxMaintenance(box.root, { reason: "fixture" }).then((value) => { entered = true; return value; });
  while ((await boxMaintenanceStatus(box.root)) === null) await delay();
  t.check(entered, false);

  await t.checkThrows(async () => (await acquireBoxWork(box.root, { reason: "test" })), "BoxMaintenanceError");

  const descendant = await acquireBoxWork(box.root, { reason: "test", inherited: env.BBX_BOX_WORK });
  child.stdin.end("finish");
  await once(child, "exit");
  t.check(entered, false);

  await descendant.release();
  const maintenance = await pending;
  await maintenance.beginChanges();
  await maintenance.release();
  const record = await boxMaintenanceStatus(box.root);
  t.check(record, { id: uuid(), reason: "fixture", phase: "exclusive", since: isoDate(), owner: null, step: undefined });

  // Unfinished maintenance refuses nothing once its owner is gone.
  const reopened = await acquireBoxWork(box.root, { reason: "test" });
  await reopened.release();

  // The next attempt closes the box again, keeps the record's start time, and
  // clears the record when it completes.
  const recovery = await acquireBoxMaintenance(box.root, { reason: "recover" });
  const retried = await boxMaintenanceStatus(box.root);
  t.check({ reason: retried?.reason, owner: retried?.owner?.reason, since: retried?.since }, { reason: "recover", owner: "recover", since: record?.since });

  await t.checkThrows(async () => (await acquireBoxWork(box.root, { reason: "test" })), "BoxMaintenanceError");

  t.check(await recovery.held(), true);

  await recovery.beginChanges();
  await recovery.complete();
  t.check(await boxMaintenanceStatus(box.root), null);

  t.check(await recovery.held(), false);

  const work = await acquireBoxWork(box.root, { reason: "test" });
  await t.checkThrows(async () => (await acquireBoxMaintenance(box.root, { reason: "timeout", drainMs: 0 })), "BoxMaintenanceError");

  t.check(await boxMaintenanceStatus(box.root), null);

  await work.release();

  // A second owner is refused by name, not with a lock stack trace.
  const owner = await closeBoxMaintenance(box.root, { reason: "deployment" });
  const refused = await acquireBoxMaintenance(box.root, { reason: "migration" }).then(() => "unexpected", (error) => `${error.name}: ${error.message}; holder=${error.holder.reason}`);
  await owner.release();
  t.check(refused.replace(/\(pid \d+, since \S+\)/u, "(pid <n>, since <time>)"), "BoxMaintenanceError: Box is closed for deployment (pid <n>, since <time>); holder=deployment");

  // Independently owned CLI actions reject a parent's inherited permission
  // immediately, rather than closing admission and waiting for themselves.
  const parentWork = await acquireBoxWork(box.root, { reason: "test" });
  const savedPermission = process.env.BBX_BOX_WORK;
  process.env.BBX_BOX_WORK = parentWork.run(boxWorkEnvironment).BBX_BOX_WORK;
  const nestedFailure = await acquireBoxMaintenance(box.root, { reason: "nested CLI", drainMs: 0 }).then(() => "unexpected", (error) => error.message);
  if (savedPermission === undefined) delete process.env.BBX_BOX_WORK; else process.env.BBX_BOX_WORK = savedPermission;
  await parentWork.release();
  t.check(nestedFailure, "Nested maintenance is not allowed");

  // A prepared replacement may initialize, while ordinary work stays closed.
  const replacement = await acquireBoxMaintenance(box.root, { reason: "replacement" });
  await replacement.beginChanges();
  await replacement.prepare();
  await t.checkThrows(async () => (await acquireBoxWork(box.root, { reason: "test", inherited: null })), "BoxMaintenanceError");

  const startup = await acquireBoxStartup(box.root);
  await t.checkThrows(async () => (await replacement.complete()), "InvariantError");

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
  t.check((await boxMaintenanceStatus(box.root))?.phase, "ready");

  await t.checkThrows(async () => (await resumed.run(() => withoutBoxWork(() => acquireBoxWork(box.root, { reason: "test" })))), "BoxMaintenanceError");

  t.check(Object.keys(resumed.run(() => withoutBoxWork(boxWorkEnvironment))), []);

  await resumed.complete();
  t.check(await boxMaintenanceStatus(box.root), null);
});

// ## A handle that lost its lock cannot touch the new owner's closure
//
// A sleep past the lock's stale window lets another owner take the box. When the
// old handle resumes, its phase writes and completion are refused, and its
// release leaves the new owner's record alone.
void test("A sleep past the lock's stale window lets another owner take the box.", async (t) => {
  t.teardown(async () => {
    try {
      await releaseLock(ownerLock);
      await sleeper.release();
      await stolenBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const stolenBox = await makeTmpBox({ git: true });
  const ownerLock = join(stolenBox.root, ".git/bbx-maintenance/owner.lock");
  const sleeper = await acquireBoxMaintenance(stolenBox.root, { reason: "sleeper" });
  await sleeper.beginChanges();
  await forceAcquireLock(ownerLock, { id: "thief", reason: "thief" });
  t.check(await sleeper.held(), false);

  await t.checkThrows(async () => (await sleeper.beginChanges()), "BoxMaintenanceError");

  await t.checkThrows(async () => (await sleeper.complete()), "BoxMaintenanceError");

  t.check((await boxMaintenanceStatus(stolenBox.root))?.owner?.reason, "thief");

  // Releasing the old handle leaves the record for the live owner to finish.
  await sleeper.release();
  t.check((await boxMaintenanceStatus(stolenBox.root))?.phase, "exclusive");
});

// ## Drain waits for lease publication, even with no published readers
//
// The admission lock protects the gap before a writer publishes its sidecar.
// An empty work directory is not sufficient evidence while that lock is held.
void test("The admission lock protects the gap before a writer publishes its sidecar.", async (t) => {
  t.teardown(async () => {
    try {
      await releaseLock(admissionPath);
      await barrier.release();
      await barrierBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const barrierBox = await makeTmpBox({ git: true });
  const admissionPath = requestScopedLock(join(barrierBox.root, ".git/bbx-maintenance/admission.lock"));
  await acquireLock(admissionPath, {});
  const barrier = await closeBoxMaintenance(barrierBox.root, { reason: "publication barrier" });
  const drained = barrier.drain().then(() => true);
  t.check(await Promise.race([drained, new Promise((resolve) => setTimeout(() => resolve(false), 100))]), false);

  await releaseLock(admissionPath);
  t.check(await drained, true);

  await barrier.complete();
  t.check(await boxMaintenanceStatus(barrierBox.root), null);
});

// ## A dead admission holder clears in seconds
//
// On 2026-10-25 a box child ran out of memory while it held the admission lock,
// and left its guard directory with no holder file. Every restart then failed
// on "Lock held by pid -1" until the hub gave up. Admission takes the request
// profile, so a guard older than its 15 s stale window is reclaimed at startup.
void test("A dead admission holder clears in seconds", async (t) => {
  const deadBox = await makeTmpBox({ git: true });
  t.teardown(() => deadBox.cleanup());
  const guard = lockGuardPath(join(deadBox.root, ".git/bbx-maintenance/admission.lock"));
  await mkdir(guard, { recursive: true });
  const lastRefresh = new Date(Date.now() - LOCK_STALE_MS.request - 5_000);
  await utimes(guard, lastRefresh, lastRefresh);

  const startup = await acquireBoxStartup(deadBox.root);
  await startup.release();
  t.check(await readdir(join(deadBox.root, ".git/bbx-maintenance")), ["work"]);
});

// ## The owner names its current step
//
// A closed box once stayed closed for ten minutes with nothing saying what was
// running. An owner, or a delegate on its behalf, names its current step, and
// the status shows it with the time it began.
void test("A closed box once stayed closed for ten minutes with nothing saying what was...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(nextStep, { recursive: true, force: true });
      await next.complete();
      await stepBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const stepBox = await makeTmpBox({ git: true });
  const stepDirectory = join(execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: stepBox.root, encoding: "utf8" }).trim(), "bbx-maintenance");
  const stepper = await acquireBoxMaintenance(stepBox.root, { reason: "docs refresh" });
  await stepper.beginChanges();
  await stepper.step("generating docs");
  t.check((await boxMaintenanceStatus(stepBox.root))?.step, {
    name: "generating docs",
    since: str`${isoDate()}`,
  });

  // The step is kept out of the phase record. Admission reads the phase record, so
  // a step write racing a phase change can never restore a stale phase. A phase
  // change ends the step.

  t.check(Object.keys(JSON.parse(await readFile(join(stepDirectory, "phase.json"), "utf8"))).toSorted(), [
    "id",
    "phase",
    "reason",
    "since",
  ]);

  await stepper.prepare();
  t.check((await boxMaintenanceStatus(stepBox.root))?.step, undefined);

  // A delegate names steps for its controller. After release, neither handle's
  // late step write replaces the step of the owner that comes next.

  await stepper.beginChanges();
  const helper = await stepper.run(() => acquireBoxMaintenance(stepBox.root, { reason: "docs", join: true }));
  await helper.step("committing");
  t.check((await boxMaintenanceStatus(stepBox.root))?.step?.name, "committing");

  await helper.release();
  await stepper.release();
  const next = await acquireBoxMaintenance(stepBox.root, { reason: "next" });
  await next.beginChanges();
  await next.step("running");
  await stepper.step("stale");
  await helper.step("stale");
  t.check((await boxMaintenanceStatus(stepBox.root))?.step?.name, "running");

  // A step is diagnostic. When it cannot be written, the work it names goes on;
  // when it cannot be read, the status still says why the box is closed.

  const nextStep = join(stepDirectory, `step-${(await boxMaintenanceStatus(stepBox.root))?.id}.json`);
  await rm(nextStep, { force: true });
  await mkdir(nextStep);
  const warnings: unknown[] = [];
  const realWarn = console.warn;
  console.warn = (message) => { warnings.push(message); };
  let status: Awaited<ReturnType<typeof boxMaintenanceStatus>>;
  try {
    await next.step("blocked");
    status = await boxMaintenanceStatus(stepBox.root);
  } finally { console.warn = realWarn; }
  t.check(({ reason: status?.reason, step: status?.step ?? "none", warnings }), {
    reason: "next",
    step: "none",
    warnings: [
      "[box-maintenance] step was not recorded:",
      "[box-maintenance] step could not be read:",
    ],
  });

  // A step that cannot be cleared does not stop a phase change either.

  const clearWarnings: unknown[] = [];
  console.warn = (message) => { clearWarnings.push(message); };
  let prepared: Awaited<ReturnType<typeof boxMaintenanceStatus>>;
  try {
    await next.prepare();
    prepared = await boxMaintenanceStatus(stepBox.root);
  } finally { console.warn = realWarn; }
  t.check(({ phase: prepared?.phase, clearWarnings }), {
    phase: "ready",
    clearWarnings: [
      "[box-maintenance] step was not cleared:",
      "[box-maintenance] step could not be read:",
    ],
  });
});

// ## A failed delegate leaves its controller's record behind
//
// The outer handle only entered draining. Its delegate began mutation and failed;
// releasing the controller must keep the persisted exclusive record, which the
// next completed attempt clears.
void test("The outer handle only entered draining.", async (t) => {
  t.teardown(async () => {
    try {
      await controller.release();
      await delegatedBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const delegatedBox = await makeTmpBox({ git: true });
  const controller = await acquireBoxMaintenance(delegatedBox.root, { reason: "outer" });
  const delegate = await controller.run(() => acquireBoxMaintenance(delegatedBox.root, { reason: "delegate", join: true }));
  await delegate.beginChanges();
  await delegate.release();
  await controller.release();
  t.check((await boxMaintenanceStatus(delegatedBox.root))?.phase, "exclusive");

  const admitted = await acquireBoxWork(delegatedBox.root, { reason: "test", inherited: null });
  await admitted.release();
  const repair = await acquireBoxMaintenance(delegatedBox.root, { reason: "recover delegate" });
  await repair.complete();
  t.check(await boxMaintenanceStatus(delegatedBox.root), null);
});

// ## A surviving delegate blocks a new owner after its own exits
//
// Joined work has its own retained lease. Replacing the controller cannot assume
// that work stopped, and expired handles cannot publish phases for the new owner
// nor prove they still hold the box.
void test("Joined work has its own retained lease.", async (t) => {
  t.teardown(async () => {
    try {
      await orphan.release();
      await oldOwner.release();
      await newOwner.release();
      await orphanBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const orphanBox = await makeTmpBox({ git: true });
  const oldOwner = await acquireBoxMaintenance(orphanBox.root, { reason: "old owner" });
  const orphan = await oldOwner.run(() => acquireBoxMaintenance(orphanBox.root, { reason: "surviving delegate", join: true }));
  await orphan.beginChanges();
  await oldOwner.release();
  const newOwner = await closeBoxMaintenance(orphanBox.root, { reason: "new owner" });
  const recoveredDrain = newOwner.drain().then(() => true);
  t.check(await Promise.race([recoveredDrain, new Promise((resolve) => setTimeout(() => resolve(false), 100))]), false);

  await t.checkThrows(async () => (await orphan.prepare()), "BoxMaintenanceError");

  t.check(await orphan.held(), false);

  await orphan.release();
  t.check(await recoveredDrain, true);

  await newOwner.prepare();
  await t.checkThrows(async () => (await oldOwner.beginChanges()), "BoxMaintenanceError");

  await t.checkThrows(async () => (await oldOwner.prepare()), "BoxMaintenanceError");

  await oldOwner.release();
  const currentPhase = await boxMaintenanceStatus(orphanBox.root);
  t.check({ reason: currentPhase?.reason, phase: currentPhase?.phase }, {
    reason: "new owner",
    phase: "ready",
  });

  await newOwner.complete();
  t.check(await boxMaintenanceStatus(orphanBox.root), null);
});

// ## Every admission names its holder, and a blocked drain reports them
//
// The per-process lease sidecar lists the live reasons. Another process reads
// them through `boxWorkHolders`; a drain that gives up names them in its error,
// so a blocked maintenance never reports only its own reason.
void test("The per-process lease sidecar lists the live reasons.", async (t) => {
  t.teardown(async () => {
    try {
      namedChild.kill();
      await namedBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const namedBox = await makeTmpBox({ git: true });
  const workDir = join(namedBox.root, ".git/bbx-maintenance/work");
  const sidecarHolders = async () => {
    const name = (await readdir(workDir)).find((entry) => entry.endsWith(".lock"));
    if (name === undefined) throw new Error("no lease sidecar");
    const lease: { metadata: { holders: { reason: string }[] } } = JSON.parse(await readFile(join(workDir, name), "utf8"));
    return lease.metadata.holders.map((holder) => holder.reason).join(", ");
  };
  const first = await acquireBoxWork(namedBox.root, { reason: "chat run one" });
  t.check(await sidecarHolders(), "chat run one");

  const second = await acquireBoxWork(namedBox.root, { reason: "POST /box/api/chat/send" });
  await new Promise((resolve) => setTimeout(resolve, 400));
  t.check(await sidecarHolders(), "chat run one, POST /box/api/chat/send");

  await first.release();
  await new Promise((resolve) => setTimeout(resolve, 400));
  t.check(await sidecarHolders(), "POST /box/api/chat/send");

  t.check(
    // This process's own leases are not "other work" to itself.
    await boxWorkHolders(namedBox.root),
    [],
  );

  await second.release();
  const namedChild = spawn(process.execPath, ["--import", "tsx", join(import.meta.dirname, "../helpers/box-maintenance-child.ts"), namedBox.root], { stdio: ["pipe", "pipe", "inherit"] });
  await once(namedChild.stdout, "data");
  t.check((await boxWorkHolders(namedBox.root)).map((holder) => `${holder.reason} pid-matches=${String(holder.pid === namedChild.pid)}`).join(", "), "fixture child pid-matches=true");

  const blocked = await acquireBoxMaintenance(namedBox.root, { reason: "deployment", drainMs: 0 }).then(() => "unexpected", (error) => error.message);
  t.check(blocked.replace(/since \S+ \(pid \d+\)/u, "since <time> (pid <n>)"), "Timed out draining box work: deployment; held by fixture child since <time> (pid <n>)");

  namedChild.stdin.end("finish");
  await once(namedChild, "exit");
  t.check(await boxWorkHolders(namedBox.root), []);
});
