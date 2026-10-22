// # The unattended migration sweep
//
// `sweepMigrations` is what `deploy.sh` runs per box after shipping new engine
// code: apply pending **script** migrations, commit each one, and leave anything
// needing a human alone. See `src/core/migration-sweep.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { strict as assert } from "node:assert";
import { MIGRATIONS, MANIFEST_PATH, type Migration } from "../../src/core/migrations.js";
import type { TmpBox } from "../helpers/test-helpers.js";
import { createFakeAgent } from "./fake-agent.js";
import { acquireBoxMaintenance, acquireBoxWork, boxMaintenanceStatus, closeBoxMaintenance } from "../../src/lib/box-maintenance/admission.js";
import { forceAcquireLock, releaseLock } from "../../src/lib/file-lock.js";
import { sweepMigrations, type SweepResult } from "../../src/core/migration-sweep.js";

// Every registered migration is retired and runs the shared no-op, so a pending
// one is a clean no-op on any box: the sweep's own bookkeeping is what gets
// tested, not a migrator's side effects. Pinned to one name; the registry is
// append-only, so it persists.
const PROBE = "annex-config-2026-08";

// No procedure-kind migration is registered any more, so the procedure tests
// append a test-only entry to this process's copy of the registry. The
// procedure itself is always the injected `runProcedure` callback.
const PROCEDURE = "test-procedure";
const procedureMigration: Migration = { name: PROCEDURE, procedure: PROCEDURE };
// MIGRATIONS is readonly to product code, and no seam injects a list; this
// test registers its procedure in the module's own registry on purpose.
Array.prototype.push.call(MIGRATIONS, procedureMigration);

type SweepStatus<S extends SweepResult["status"]> = Extract<SweepResult, { status: S }>;

function hasStatus<S extends SweepResult["status"]>(result: SweepResult, status: S): result is SweepStatus<S> {
  return result.status === status;
}

/** Narrow a sweep result to one status so its fields can be read. */
function expectStatus<S extends SweepResult["status"]>(result: SweepResult, status: S): SweepStatus<S> {
  if (!hasStatus(result, status)) throw new Error(`expected sweep status ${status}, got ${result.status}`);
  return result;
}

/** The question path of a failed sweep. */
function questionOf(result: SweepResult): string {
  const failed = expectStatus(result, "failed");
  assert.ok(failed.question !== undefined);
  return failed.question;
}

/** Seed the manifest as fully applied, optionally leaving some names pending. */
async function seedManifest(box: TmpBox, opts: { pending: string[] }) {
  const pending = new Set(opts.pending);
  const lines = MIGRATIONS
    .filter((m) => !pending.has(m.name))
    .map((m) => JSON.stringify({ name: m.name, "applied-at": "2026-01-01T00:00:00.000Z" }));
  await box.write(MANIFEST_PATH, lines.join("\n") + "\n");
}

function git(box: TmpBox, ...args: string[]) {
  return execFileSync("git", args, { cwd: box.root }).toString().trim();
}

// ## A box with nothing pending says nothing and does nothing
//
// The common case — this runs against every box on every deploy, so the quiet
// path has to stay quiet. The commit count is the check that it really did
// nothing.
void test("The common case — this runs against every box on every deploy, so the quiet p...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await seedManifest(box, { pending: [] });
  await box.commitAll("seed migration manifest");
  const before = git(box, "rev-list", "--count", "HEAD");

  const result = await sweepMigrations({ boxRoot: box.root });
  t.check({ status: result.status, newCommits: Number(git(box, "rev-list", "--count", "HEAD")) - Number(before) }, {
    status: "current",
    newCommits: 0,
  });

  // The quiet path never closes admission. With live work on the box, a sweep that
  // closed first would sit in its drain until that work ended; this one reads,
  // finds nothing, and returns while the work is still admitted.

  const busy = await acquireBoxWork(box.root, { reason: "live chat run" });
  const quiet = sweepMigrations({ boxRoot: box.root }).then((outcome) => outcome.status);
  t.check(await Promise.race([quiet, new Promise((resolve) => setTimeout(() => resolve("still draining"), 3000))]), "current");

  t.check(await boxMaintenanceStatus(box.root), null);

  await busy.release();
});

// ## A pending script migration is applied and committed as one unit
//
// The manifest entry and the changes it describes land in the **same** commit, so
// a box can never claim a migration whose effects are not in its history. The
// commit carries the `Created-By` trailer the box's other automated writers use.
//
// `annex-config-2026-08` is the migration under test here (see the setup note):
// it runs the retired no-op, which proves the sweep's own bookkeeping without
// depending on a migrator's side effects.
void test("The manifest entry and the changes it describes land in the same commit, so a...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await seedManifest(box, { pending: [PROBE] });
  await box.commitAll("seed migration manifest");

  const result = await sweepMigrations({ boxRoot: box.root });
  t.check({ status: result.status, applied: expectStatus(result, "applied").applied.map((m) => m.name) }, {
    status: "applied",
    applied: [
      "annex-config-2026-08",
    ],
  });

  t.check(
    {
      subject: git(box, "log", "-1", "--format=%s"),
      trailer: git(box, "log", "-1", "--format=%(trailers:key=Created-By,valueonly)"),
      manifestInCommit: git(box, "show", "--name-only", "--format=", "HEAD").includes(MANIFEST_PATH),
      clean: git(box, "status", "--porcelain") === "",
    },
    {
    subject: "Apply migration: annex-config-2026-08",
    trailer: "migration-sweep",
    manifestInCommit: true,
    clean: true,
  },
  );

  // A second sweep is a no-op — the manifest now records it:

  t.check((await sweepMigrations({ boxRoot: box.root })).status, "current");
});

// ## A procedure migration after an applied script reopens the box
//
// An unattended sweep has no procedure runner. It applies and commits the script
// migrations before the first procedure migration, then stops there. The box is
// consistent at that point: every applied migration is committed and the procedure
// has not started. The sweep must reopen the box. A box left "exclusive" here
// refused every request with "Box is closed for migration" until someone repaired
// it by hand (all four local dev boxes, 2026-09-16).
void test("An unattended sweep has no procedure runner.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await seedManifest(box, { pending: [PROBE, PROCEDURE] });
  await box.commitAll("script then procedure pending");
  const result = await sweepMigrations({ boxRoot: box.root });
  t.check(
    {
      status: result.status,
      applied: expectStatus(result, "needs-procedure").applied.map((m) => m.name),
      phase: await boxMaintenanceStatus(box.root),
    },
    {
    status: "needs-procedure",
    applied: [
      "annex-config-2026-08",
    ],
    phase: null,
  },
  );
});

// ## An unattended pass runs a procedure once per human answer
//
// With a runner, the `--repair` pass applies procedure migrations itself. A run
// that fails writes one question and stops; the next passes run nothing while it
// is unanswered. Answering it authorizes exactly one more run. Every pass reports
// `failed` with the question, so the schedule keeps naming it.
void test("With a runner, the --repair pass applies procedure migrations itself.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await seedManifest(box, { pending: [PROCEDURE] });
  await box.commitAll("procedure pending");
  let runs = 0;
  let exit = 1;
  const runProcedure = async (procedure: string, { onOutput }: { onOutput: (text: string) => void }) => { runs += 1; onOutput(`${procedure} attempt ${String(runs)} failed\n`); return exit; };
  const first = await sweepMigrations({ boxRoot: box.root, repair: true, unattended: true, runProcedure });
  const questionText = await box.read(questionOf(first));
  t.check({ status: first.status, runs, question: questionOf(first), carriesOutput: questionText.includes("test-procedure attempt 1 failed"), receipt: git(box, "for-each-ref", "--format=%(refname)", "refs/bbx/migrations/test-procedure/repair-started") }, {
    status: "failed",
    runs: 1,
    question: "_bookkeeping/questions/Migration_test-procedure-0.question.card",
    carriesOutput: true,
    receipt: "",
  });

  const second = await sweepMigrations({ boxRoot: box.root, repair: true, unattended: true, runProcedure });
  const record = await boxMaintenanceStatus(box.root);
  t.check({ status: second.status, runs, question: questionOf(second), record: record?.phase, owner: record?.owner }, {
    status: "failed",
    runs: 1,
    question: "_bookkeeping/questions/Migration_test-procedure-0.question.card",
    record: "exclusive",
    owner: null,
  });

  await box.write(questionOf(first), questionText.replace("---\n", "---\nanswer:\n  text: Retry it\nanswered-at: 2026-09-17T00:00:00.000Z\n"));
  await box.commitAll("answer");
  exit = 0;
  const third = await sweepMigrations({ boxRoot: box.root, repair: true, unattended: true, runProcedure });
  t.check({ status: third.status, runs, recorded: (await box.read(MANIFEST_PATH)).includes(PROCEDURE) }, {
    status: "applied",
    runs: 2,
    recorded: true,
  });

  // A run that never finished (killed by the execution timeout) leaves its receipt.
  // The next pass writes the question instead of running again, naming the
  // unfinished attempt's own snapshot, and a person's `--apply` still runs the
  // procedure directly:

  await box.write(MANIFEST_PATH, (await box.read(MANIFEST_PATH)).split("\n").filter((line) => !line.includes(PROCEDURE)).join("\n"));
  await box.commitAll("pending again");
  const unfinished = git(box, "rev-parse", "HEAD");
  git(box, "update-ref", "refs/bbx/migrations/test-procedure/repair-started", unfinished);
  const stale = await sweepMigrations({ boxRoot: box.root, repair: true, unattended: true, runProcedure });
  t.check({ status: stale.status, runs, question: questionOf(stale), namesReceipt: (await box.read(questionOf(stale))).includes(`Recovery: ${unfinished}`) }, {
    status: "failed",
    runs: 2,
    question: "_bookkeeping/questions/Migration_test-procedure-1.question.card",
    namesReceipt: true,
  });

  const manual = await sweepMigrations({ boxRoot: box.root, repair: true, unattended: false, runProcedure });
  t.check({ status: manual.status, runs, recorded: (await box.read(MANIFEST_PATH)).includes(PROCEDURE), open: expectStatus(manual, "attention").questions }, {
    status: "attention",
    runs: 3,
    recorded: true,
    open: [
      "_bookkeeping/questions/Migration_test-procedure-1.question.card",
    ],
  });
});

// ## A scheduled pass yields to a box in use
//
// `--yield` is the hourly schedule's mode. An idle chat run holds a lease until
// the box's server sees a maintenance phase and closes it, so the pass cannot
// tell "in use" from the leases alone: it closes, waits fifteen seconds, and
// work that outlasts the wait means the box is in use. That pass is deferred to
// the next hour, naming the holder, and the box reopens. Once the box is free
// the same pass applies the work. A deploy does not yield.
void test("--yield is the hourly schedule's mode.", async (t) => {
  t.teardown(async () => {
    try {
      holder.kill();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await seedManifest(box, { pending: [PROBE] });
  await box.commitAll("seed migration manifest");
  const holder = spawn(process.execPath, ["--import", "tsx", join(import.meta.dirname, "../helpers/box-maintenance-child.ts"), box.root], { stdio: ["pipe", "pipe", "inherit"] });
  await once(holder.stdout, "data");

  const deferred = await sweepMigrations({ boxRoot: box.root, yield: true });
  t.check({ status: deferred.status, holders: expectStatus(deferred, "deferred").holders.map((entry) => entry.reason), phase: await boxMaintenanceStatus(box.root) }, {
    status: "deferred",
    holders: [
      "fixture child",
    ],
    phase: null,
  });

  holder.stdin.end("finish");
  await once(holder, "exit");
  t.check((await sweepMigrations({ boxRoot: box.root, yield: true })).status, "applied");

  // A deploy holding the maintenance owner lock is the other way a box is in use.
  // That is what the lock is for, so a yielding pass defers and names it rather
  // than failing the check.

  await seedManifest(box, { pending: [PROBE] });
  const deploy = await closeBoxMaintenance(box.root, { reason: "deployment" });
  const behindDeploy = await sweepMigrations({ boxRoot: box.root, yield: true });
  await deploy.release();
  t.check({ status: behindDeploy.status, holders: expectStatus(behindDeploy, "deferred").holders.map((entry) => entry.reason) }, {
    status: "deferred",
    holders: [
      "deployment",
    ],
  });
});

// ## A dirty box converges without committing unrelated work
//
// The recovery ref preserves input while the path-scoped output commit leaves unrelated working files and staging alone.
void test("The recovery ref preserves input while the path-scoped output commit leaves u...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await seedManifest(box, { pending: [PROBE] });
  await box.commitAll("seed migration manifest");
  await box.write("_content/inbox/Half_Written.doc.card", "---\ntitle: Note\n---\nmid-edit\n");

  const result = await sweepMigrations({ boxRoot: box.root });
  t.check({ status: result.status, untracked: git(box, "ls-files", "--others", "--exclude-standard") }, {
    status: "applied",
    untracked: "_content/inbox/Half_Written.doc.card",
  });

  // The migration was recorded despite the unrelated dirty file:

  // The manifest lists every shipped migration; only this entry is the contract.
  t.check(await box.read(MANIFEST_PATH), any(String).includes(PROBE));
});

// ## A commit that fails rolls the manifest entry back
//
// The manifest entry has to be written *before* the commit, because it belongs in
// it. So a commit that fails — the box's own pre-commit hook rejecting a card the
// migrator produced, say — must not leave a manifest claiming a migration that
// never landed: the next sweep would read that line, report the box current, and
// never retry.
//
// Simulated by making the commit fail for a reason the sweep cannot foresee: a
// pre-commit hook that always rejects.
void test("The manifest entry has to be written before the commit, because it belongs in...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await seedManifest(box, { pending: [PROBE] });
  await box.commitAll("seed migration manifest");
  // The repo root is not necessarily box.root (a v2 box roots at the package
  // dir, one level up), so ask git where its hooks actually live.
  const hookPath = join(git(box, "rev-parse", "--absolute-git-dir"), "hooks", "pre-commit");
  // APPEND the rejection rather than replacing the hook. The box is annexed, so
  // its stock hook invokes `git annex pre-commit`; overwriting that would break
  // the box's annex configuration and the sweep would fail for that reason
  // instead of the one under test.
  const stockHook = await readFile(hookPath, "utf8").catch(() => "#!/bin/sh\n");
  await writeFile(hookPath, `${stockHook}\nexit 1\n`);
  await chmod(hookPath, 0o755);

  const result = await sweepMigrations({ boxRoot: box.root });
  t.check(result.status, "commit-failed");

  // The manifest is back to what it was, so the migration is still pending and the
  // next sweep retries it:

  t.check(
    {
      recorded: (await box.read(MANIFEST_PATH)).includes(PROBE),
      head: git(box, "log", "-1", "--format=%s"),
    },
    {
    recorded: false,
    head: "seed migration manifest",
  },
  );
});

// ## A box with no manifest at all is left alone
//
// It predates `bbx migrate`, and only a human can say whether it is already
// migrated (`--mark-all-applied`) or genuinely needs the whole queue. A fresh
// `bbx init` box always seeds a manifest, so this simulates the legacy case by
// removing it (a real pre-`bbx migrate` box on disk simply never had one):
void test("It predates bbx migrate, and only a human can say whether it is already migra...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await rm(join(box.root, MANIFEST_PATH));
  t.check((await sweepMigrations({ boxRoot: box.root })).status, "no-manifest");
});

// ## Partial conversion asks once and lets later migrations proceed
void test("Partial conversion asks once and lets later migrations proceed", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  // Keep this pinned to a script migration: procedure migrations are intentionally
  // not handled by the unattended sweep.
  const later = "search-interface-card";
  await seedManifest(box, { pending: [PROBE, later] });
  await box.commitAll("seed");
  let agents = 0;
  let calls = 0;
  const result = await sweepMigrations({
    boxRoot: box.root, repair: true,
    // Every entry runs the same tombstone script, so tell PROBE's runs apart by
    // the manifest: PROBE is the one running while it is still unrecorded.
    runScript: async ({ boxRoot }) => {
      calls += 1;
      return (await readFile(join(boxRoot, MANIFEST_PATH), "utf8")).includes(PROBE) ? 0 : 2;
    },
    repairAgent: createFakeAgent({ name: "repair", sessionId: "repair-session", act: async () => ({}), structuredResult: () => {
      agents += 1;
      return { status: "needs-human", reason: "Choose between divergent copies." };
    } }),
  });
  t.check({ status: result.status, applied: expectStatus(result, "attention").applied.length, partial: expectStatus(result, "attention").applied[0]?.partial, agents, calls }, {
    status: "attention",
    applied: 2,
    partial: true,
    agents: 1,
    calls: 3,
  });

  const next = await sweepMigrations({ boxRoot: box.root });
  t.check({ status: next.status, questions: expectStatus(next, "attention").questions.length }, {
    status: "attention",
    questions: 1,
  });
});

// ## A joined blocker revokes readiness and leaves deployment closed
//
// A missing manifest is not permission to activate new code, even if an earlier
// nested operation prepared readiness. The outer controller retains the closed
// phase after its owner releases. A pending procedure is different: the box is
// consistent and the next unattended pass applies it, so deployment marks it
// ready.
void test("A missing manifest is not permission to activate new code, even if an earlier...", async (t) => {
  t.teardown(async () => {
    try {
      await owner.release();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await rm(join(box.root, MANIFEST_PATH));
  const owner = await acquireBoxMaintenance(box.root, { reason: "deployment" });
  await owner.prepare();
  const result = await owner.run(() => sweepMigrations({ boxRoot: box.root, withinMaintenance: true }));
  await owner.release();
  t.check({ status: result.status, phase: (await boxMaintenanceStatus(box.root))?.phase }, {
    status: "no-manifest",
    phase: "exclusive",
  });
});

void test("A joined blocker revokes readiness and leaves deployment closed", async (t) => {
  t.teardown(async () => {
    try {
      await owner.release();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await seedManifest(box, { pending: [PROCEDURE] });
  await box.commitAll("pending procedure");
  const owner = await acquireBoxMaintenance(box.root, { reason: "deployment" });
  await owner.prepare();
  const result = await owner.run(() => sweepMigrations({ boxRoot: box.root, withinMaintenance: true }));
  await owner.release();
  t.check({ status: result.status, phase: (await boxMaintenanceStatus(box.root))?.phase }, {
    status: "needs-procedure",
    phase: "ready",
  });
});

// ## A failed migration never leaves the box closed
//
// The 2026-09-16 incident: a sweep closed a box, stopped without completing, and
// the box refused every request until repaired by hand. Now the closure ends with
// the owner. The failure leaves a record of unfinished maintenance and its
// recovery ref; ordinary work is admitted, and the next completed sweep clears
// the record.
void test("The 2026-09-16 incident:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await seedManifest(box, { pending: [PROBE] });
  await box.commitAll("seed");
  const failed = await sweepMigrations({ boxRoot: box.root, runScript: async () => 1 });
  const record = await boxMaintenanceStatus(box.root);
  t.check({ status: failed.status, phase: record?.phase, owner: record?.owner, ref: git(box, "for-each-ref", "--format=%(refname)", expectStatus(failed, "failed").recoveryRef) === expectStatus(failed, "failed").recoveryRef }, {
    status: "failed",
    phase: "exclusive",
    owner: null,
    ref: true,
  });

  const work = await acquireBoxWork(box.root, { reason: "chat run" });
  await work.release();
  t.check((await sweepMigrations({ boxRoot: box.root, runScript: async () => 0 })).status, "applied");

  t.check(await boxMaintenanceStatus(box.root), null);
});

// ## An owner that lost the box does not commit
//
// A sleep longer than the lock's stale window, or a deploy controller that died
// under a joined sweep, leaves the script running without exclusion. The sweep
// notices before committing: the output stays under its recovery ref, the
// manifest is untouched, and no repair agent is spent on a lock nobody can win
// back. Stealing the owner lock stands in for the stale window.
void test("A sleep longer than the lock's stale window, or a deploy controller that died...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await seedManifest(box, { pending: [PROBE] });
  await box.commitAll("seed");
  const ownerLock = join(git(box, "rev-parse", "--absolute-git-dir"), "bbx-maintenance/owner.lock");
  let repairs = 0;
  const lost = await sweepMigrations({ boxRoot: box.root, repair: true,
    repairAgent: createFakeAgent({ name: "repair", act: async () => ({}), structuredResult: () => { repairs += 1; return { status: "fixed" }; } }),
    runScript: async () => { await forceAcquireLock(ownerLock, { id: "thief" }); await releaseLock(ownerLock); return 0; } });
  t.check({ status: lost.status, error: expectStatus(lost, "commit-failed").error, repairs, recorded: (await box.read(MANIFEST_PATH)).includes(PROBE) }, {
    status: "commit-failed",
    error: "maintenance ownership lost",
    repairs: 0,
    recorded: false,
  });
});

// ## A rejected commit retains conversion output across an idempotent retry
//
// The new attempt snapshots current input and staging, but its output comparison
// keeps the original failed attempt's baseline. A converter writing identical
// bytes on retry must still commit those bytes with the manifest.
void test("The new attempt snapshots current input and staging, but its output compariso...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await seedManifest(box, { pending: [PROBE] });
  await box.write("_content/Converted.doc.card", "---\ntitle: Note\n---\nOriginal\n");
  await box.write("_content/unrelated.txt", "original\n");
  await box.commitAll("seed");
  await box.write("_content/unrelated.txt", "staged unrelated\n");
  git(box, "add", "_content/unrelated.txt");
  const hook = join(git(box, "rev-parse", "--absolute-git-dir"), "hooks/pre-commit");
  await writeFile(hook, "#!/bin/sh\nexit 1\n");
  await chmod(hook, 0o755);
  const converted = "---\ntitle: Note\n---\nConverted\n";
  const runScript = async () => { await box.write("_content/Converted.doc.card", converted); return 0; };
  t.check((await sweepMigrations({ boxRoot: box.root, runScript })).status, "commit-failed");

  await rm(hook);
  t.check((await sweepMigrations({ boxRoot: box.root, repair: true, runScript })).status, "applied");

  t.check({ committed: git(box, "show", "HEAD:_content/Converted.doc.card").endsWith("Converted"), staged: git(box, "diff", "--cached", "--name-only"), unstaged: git(box, "diff", "--name-only"), pendingRef: git(box, "for-each-ref", "--format=%(refname)", `refs/bbx/migrations/${PROBE}/pending`) }, {
    committed: true,
    staged: "_content/unrelated.txt",
    unstaged: "",
    pendingRef: "",
  });
});

// ## A question left uncommitted does not block the migration's commit
//
// 2026-10-21: a failed migration wrote a question quoting `/home/<user>/` paths,
// the box commit lint refused it, and it stayed uncommitted. The next pass's
// commit carried it too, so the migration could never commit even once its
// script succeeded. The sweep now rewrites those paths before it commits. The
// hook below stands in for the lint.
void test("A leftover question with a machine path commits redacted with the migration", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await seedManifest(box, { pending: [PROBE] });
  await box.commitAll("seed");
  const question = `_bookkeeping/questions/Migration_${PROBE}-0.question.card`;
  await box.write(question, "---\nmemo: Migration needs attention\nprompt: |\n  failed in /home/beebox/boxes/a\ninput:\n  type: text\nasked-at: 2026-10-20T00:00:00.000Z\n---\n");
  const hook = join(git(box, "rev-parse", "--absolute-git-dir"), "hooks/pre-commit");
  const stockHook = await readFile(hook, "utf8").catch(() => "#!/bin/sh\n");
  await writeFile(hook, `${stockHook}\nif git diff --cached | grep -q '^+.*/home/beebox/'; then exit 1; fi\n`);
  await chmod(hook, 0o755);

  const result = await sweepMigrations({ boxRoot: box.root, repair: true, runScript: async () => 0 });
  t.check({ status: result.status, committed: git(box, "show", `HEAD:${question}`).includes("failed in ~beebox/boxes/a"), dirty: git(box, "status", "--porcelain") }, {
    status: "attention",
    committed: true,
    dirty: "",
  });
});
