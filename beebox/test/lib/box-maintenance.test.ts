// # Shared admission closes before draining
//
// A real child holds admitted work. Closing stops another root operation while
// allowing a retained descendant to finish; maintenance starts only after both
// release. A failed mutation leaves a record of unfinished maintenance, and the
// box reopens the moment its owner is gone: a closure cannot outlive its owner.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate, str } from "@ianbicking/tap-check/check";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { acquireLock, forceAcquireLock, releaseLock } from "../../src/lib/file-lock.js";
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
  // doctest:L20
  const box = await makeTmpBox({ git: true });
  const child = spawn(process.execPath, ["--import", "tsx", join(import.meta.dirname, "../helpers/box-maintenance-child.ts"), box.root], { stdio: ["pipe", "pipe", "inherit"] });
  const [data] = await once(child.stdout, "data");
  const env: { BBX_BOX_WORK: string } = JSON.parse(String(data));
  let entered = false;
  const pending = acquireBoxMaintenance(box.root, { reason: "fixture" }).then((value) => { entered = true; return value; });
  while ((await boxMaintenanceStatus(box.root)) === null) await delay();
  t.check(entered, false);

  // doctest:L30
  await t.checkThrows(async () => (await acquireBoxWork(box.root, { reason: "test" })), "BoxMaintenanceError");

  // doctest:L33
  const descendant = await acquireBoxWork(box.root, { reason: "test", inherited: env.BBX_BOX_WORK });
  child.stdin.end("finish");
  await once(child, "exit");
  t.check(entered, false);

  // doctest:L39
  await descendant.release();
  const maintenance = await pending;
  await maintenance.beginChanges();
  await maintenance.release();
  const record = await boxMaintenanceStatus(box.root);
  t.check(`${record?.phase} owner=${String(record?.owner)} since=${typeof record?.since}`, "exclusive owner=null since=string");

  // doctest:L47
  // Unfinished maintenance refuses nothing once its owner is gone.
  const reopened = await acquireBoxWork(box.root, { reason: "test" });
  await reopened.release();

  // doctest:L51
  // The next attempt closes the box again, keeps the record's start time, and
  // clears the record when it completes.
  const recovery = await acquireBoxMaintenance(box.root, { reason: "recover" });
  const retried = await boxMaintenanceStatus(box.root);
  t.check(`${retried?.reason} owner=${retried?.owner?.reason} carried=${String(retried?.since === record?.since)}`, "recover owner=recover carried=true");

  // doctest:L58
  await t.checkThrows(async () => (await acquireBoxWork(box.root, { reason: "test" })), "BoxMaintenanceError");

  // doctest:L61
  t.check(await recovery.held(), true);

  // doctest:L64
  await recovery.beginChanges();
  await recovery.complete();
  t.check(await boxMaintenanceStatus(box.root), null);

  // doctest:L69
  t.check(await recovery.held(), false);

  // doctest:L72
  const work = await acquireBoxWork(box.root, { reason: "test" });
  await t.checkThrows(async () => (await acquireBoxMaintenance(box.root, { reason: "timeout", drainMs: 0 })), "BoxMaintenanceError");

  // doctest:L76
  t.check(await boxMaintenanceStatus(box.root), null);

  // doctest:L79
  await work.release();

  // doctest:L81
  // A second owner is refused by name, not with a lock stack trace.
  const owner = await closeBoxMaintenance(box.root, { reason: "deployment" });
  const refused = await acquireBoxMaintenance(box.root, { reason: "migration" }).then(() => "unexpected", (error) => `${error.name}: ${error.message}; holder=${error.holder.reason}`);
  await owner.release();
  t.check(refused.replace(/\(pid \d+, since \S+\)/u, "(pid <n>, since <time>)"), "BoxMaintenanceError: Box is closed for deployment (pid <n>, since <time>); holder=deployment");

  // doctest:L88
  // Independently owned CLI actions reject a parent's inherited permission
  // immediately, rather than closing admission and waiting for themselves.
  const parentWork = await acquireBoxWork(box.root, { reason: "test" });
  const savedPermission = process.env.BBX_BOX_WORK;
  process.env.BBX_BOX_WORK = parentWork.run(boxWorkEnvironment).BBX_BOX_WORK;
  const nestedFailure = await acquireBoxMaintenance(box.root, { reason: "nested CLI", drainMs: 0 }).then(() => "unexpected", (error) => error.message);
  if (savedPermission === undefined) delete process.env.BBX_BOX_WORK; else process.env.BBX_BOX_WORK = savedPermission;
  await parentWork.release();
  t.check(nestedFailure, "Nested maintenance is not allowed");

  // doctest:L99
  // A prepared replacement may initialize, while ordinary work stays closed.
  const replacement = await acquireBoxMaintenance(box.root, { reason: "replacement" });
  await replacement.beginChanges();
  await replacement.prepare();
  await t.checkThrows(async () => (await acquireBoxWork(box.root, { reason: "test", inherited: null })), "BoxMaintenanceError");

  // doctest:L106
  const startup = await acquireBoxStartup(box.root);
  await t.checkThrows(async () => (await replacement.complete()), "InvariantError");

  // doctest:L110
  await startup.release();
  await replacement.release();
  // The replacement's owner is gone, so startup is ordinary again.
  const restarted = await acquireBoxStartup(box.root);
  await restarted.release();

  // doctest:L116
  // A new owner republishes its id, allowing its delegated refresh.
  const resumed = await acquireBoxMaintenance(box.root, { reason: "resume" });
  const joined = await resumed.run(() => acquireBoxMaintenance(box.root, { reason: "docs", join: true }));
  await joined.prepare();
  await joined.release();
  await joined.release();
  t.check((await boxMaintenanceStatus(box.root))?.phase, "ready");

  // doctest:L125
  await t.checkThrows(async () => (await resumed.run(() => withoutBoxWork(() => acquireBoxWork(box.root, { reason: "test" })))), "BoxMaintenanceError");

  // doctest:L128
  t.check(Object.keys(resumed.run(() => withoutBoxWork(boxWorkEnvironment))), []);

  // doctest:L131
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
  // doctest:L148
  const stolenBox = await makeTmpBox({ git: true });
  const ownerLock = join(stolenBox.root, ".git/bbx-maintenance/owner.lock");
  const sleeper = await acquireBoxMaintenance(stolenBox.root, { reason: "sleeper" });
  await sleeper.beginChanges();
  await forceAcquireLock(ownerLock, { id: "thief", reason: "thief" });
  t.check(await sleeper.held(), false);

  // doctest:L156
  await t.checkThrows(async () => (await sleeper.beginChanges()), "BoxMaintenanceError");

  // doctest:L159
  await t.checkThrows(async () => (await sleeper.complete()), "BoxMaintenanceError");

  // doctest:L162
  t.check((await boxMaintenanceStatus(stolenBox.root))?.owner?.reason, "thief");

  // doctest:L165
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
  // doctest:L183
  const barrierBox = await makeTmpBox({ git: true });
  const admissionPath = join(barrierBox.root, ".git/bbx-maintenance/admission.lock");
  await acquireLock(admissionPath, {});
  const barrier = await closeBoxMaintenance(barrierBox.root, { reason: "publication barrier" });
  const drained = barrier.drain().then(() => true);
  t.check(await Promise.race([drained, new Promise((resolve) => setTimeout(() => resolve(false), 100))]), false);

  // doctest:L191
  await releaseLock(admissionPath);
  t.check(await drained, true);

  // doctest:L195
  await barrier.complete();
  t.check(await boxMaintenanceStatus(barrierBox.root), null);
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
  // doctest:L213
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

  // doctest:L227
  t.check(Object.keys(JSON.parse(await readFile(join(stepDirectory, "phase.json"), "utf8"))).toSorted(), [
    "id",
    "phase",
    "reason",
    "since",
  ]);

  // doctest:L230
  await stepper.prepare();
  t.check((await boxMaintenanceStatus(stepBox.root))?.step, undefined);

  // A delegate names steps for its controller. After release, neither handle's
  // late step write replaces the step of the owner that comes next.

  // doctest:L239
  await stepper.beginChanges();
  const helper = await stepper.run(() => acquireBoxMaintenance(stepBox.root, { reason: "docs", join: true }));
  await helper.step("committing");
  t.check((await boxMaintenanceStatus(stepBox.root))?.step?.name, "committing");

  // doctest:L245
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

  // doctest:L260
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

  // doctest:L278
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
  // doctest:L302
  const delegatedBox = await makeTmpBox({ git: true });
  const controller = await acquireBoxMaintenance(delegatedBox.root, { reason: "outer" });
  const delegate = await controller.run(() => acquireBoxMaintenance(delegatedBox.root, { reason: "delegate", join: true }));
  await delegate.beginChanges();
  await delegate.release();
  await controller.release();
  t.check((await boxMaintenanceStatus(delegatedBox.root))?.phase, "exclusive");

  // doctest:L311
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
  // doctest:L331
  const orphanBox = await makeTmpBox({ git: true });
  const oldOwner = await acquireBoxMaintenance(orphanBox.root, { reason: "old owner" });
  const orphan = await oldOwner.run(() => acquireBoxMaintenance(orphanBox.root, { reason: "surviving delegate", join: true }));
  await orphan.beginChanges();
  await oldOwner.release();
  const newOwner = await closeBoxMaintenance(orphanBox.root, { reason: "new owner" });
  const recoveredDrain = newOwner.drain().then(() => true);
  t.check(await Promise.race([recoveredDrain, new Promise((resolve) => setTimeout(() => resolve(false), 100))]), false);

  // doctest:L341
  await t.checkThrows(async () => (await orphan.prepare()), "BoxMaintenanceError");

  // doctest:L344
  t.check(await orphan.held(), false);

  // doctest:L347
  await orphan.release();
  t.check(await recoveredDrain, true);

  // doctest:L351
  await newOwner.prepare();
  await t.checkThrows(async () => (await oldOwner.beginChanges()), "BoxMaintenanceError");

  // doctest:L355
  await t.checkThrows(async () => (await oldOwner.prepare()), "BoxMaintenanceError");

  // doctest:L358
  await oldOwner.release();
  const currentPhase = await boxMaintenanceStatus(orphanBox.root);
  t.check({ reason: currentPhase?.reason, phase: currentPhase?.phase }, {
    reason: "new owner",
    phase: "ready",
  });

  // doctest:L363
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
  // doctest:L382
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

  // doctest:L394
  const second = await acquireBoxWork(namedBox.root, { reason: "POST /box/api/chat/send" });
  await new Promise((resolve) => setTimeout(resolve, 400));
  t.check(await sidecarHolders(), "chat run one, POST /box/api/chat/send");

  // doctest:L399
  await first.release();
  await new Promise((resolve) => setTimeout(resolve, 400));
  t.check(await sidecarHolders(), "POST /box/api/chat/send");

  // doctest:L404
  t.check(
    // This process's own leases are not "other work" to itself.
    await boxWorkHolders(namedBox.root),
    [],
  );

  // doctest:L408
  await second.release();
  const namedChild = spawn(process.execPath, ["--import", "tsx", join(import.meta.dirname, "../helpers/box-maintenance-child.ts"), namedBox.root], { stdio: ["pipe", "pipe", "inherit"] });
  await once(namedChild.stdout, "data");
  t.check((await boxWorkHolders(namedBox.root)).map((holder) => `${holder.reason} pid-matches=${String(holder.pid === namedChild.pid)}`).join(", "), "fixture child pid-matches=true");

  // doctest:L414
  const blocked = await acquireBoxMaintenance(namedBox.root, { reason: "deployment", drainMs: 0 }).then(() => "unexpected", (error) => error.message);
  t.check(blocked.replace(/since \S+ \(pid \d+\)/u, "since <time> (pid <n>)"), "Timed out draining box work: deployment; held by fixture child since <time> (pid <n>)");

  // doctest:L418
  namedChild.stdin.end("finish");
  await once(namedChild, "exit");
  t.check(await boxWorkHolders(namedBox.root), []);
});
