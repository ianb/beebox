/**
 * The 2026-08-24 adversarial review's findings, one test each: stale locks,
 * heartbeat discipline, orphaned handoffs, refused launches, process-group
 * kills, and log-tail bounds.
 *
 *   node --import tsx --test bin/schedules-hardening.test.ts
 *
 * Split out of bin/schedules.test.ts; fixtures are bin/schedules-test-support.ts.
 */

import assert from "node:assert/strict";
import { after, test } from "node:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { tickPath } from "./lib/schedules-launchd.js";
import {
  acquireLock,
  ensureStoreRoot,
  isLockStale,
  lockStaleAfterMs,
  readAlerts,
  readScheduleState,
  readStoreState,
} from "./lib/schedules-store.js";
import {
  INTERRUPTED_HANDOFF_ALERT_TITLE,
  refuseRunHere,
  runSchedule,
} from "./lib/schedules-runner.js";
import { tick } from "./lib/schedules-tick.js";
import { OUTPUT_TAIL_LINES, execChild } from "./lib/schedules-exec.js";
import { REGISTRY_COMPLETION_ALERT_TITLE, agentState } from "./lib/schedules-workstream.js";
import {
  BASE_YAML,
  HANDOFF_RUN,
  HOUR,
  REPO,
  REPORTS_DONE,
  cleanupTempDirs,
  launchRig,
  makeDeps,
  makeSchedule,
  onlySchedule,
  tempDir,
  useTempRegistryStateDir,
  withFakeAgent,
  workstreamYaml,
} from "./schedules-test-support.js";

after(cleanupTempDirs);
await useTempRegistryStateDir();

// ─── Adversarial review, 2026-08-24 ───────────────────────────────────────

test("a first persistent run keeps its lastRunAt when the session id is stored", async () => {
  const rig = await launchRig({
    name: "sdk-update",
    yaml: workstreamYaml("  worktree: false").replace("session: fresh", "session: persistent"),
    run: HANDOFF_RUN,
    liveness: "none",
    agentExit: 0,
    agentExtra: REPORTS_DONE,
    check: null,
  });
  const report = await withFakeAgent(rig, async () => runSchedule(rig.fake.deps, { schedule: rig.schedule, dryRun: false }));
  assert.ok(report.kind === "ran");
  const state = await readScheduleState(rig.fake.deps.storeRoot, "sdk-update");
  // The session-id write is a read-modify-write, so the run this session
  // belongs to is still recorded: anything else leaves the schedule due again
  // on the very next tick, launching a second session every fifteen minutes.
  assert.equal(state.lastRunAt, "2026-08-24T12:00:00.000Z");
  assert.equal(state.lastRunId, report.runId);
  assert.equal(state.lastOutcome, "handoff");
  assert.ok(state.sessionId !== null);
});

test("a lock older than its stale window is reclaimed even when its pid is alive", async () => {
  const { schedulesRoot } = await makeSchedule("stalejob", { yaml: BASE_YAML, run: "#!/bin/sh\necho ran\n" });
  const fake = await makeDeps({ schedulesRoot, nowMs: Date.parse("2026-08-24T12:00:00Z") });
  await ensureStoreRoot(fake.deps.storeRoot);
  await acquireLock(fake.deps.storeRoot, {
    name: "stalejob",
    runId: "20260824-000000",
    pid: 4242,
    isProcessAlive: () => true,
    at: new Date(Date.parse("2026-08-24T12:00:00Z") - lockStaleAfterMs(2 * HOUR) - 1),
    staleAfterMs: lockStaleAfterMs(2 * HOUR),
    bootTimeMs: null,
  });
  // A PID the kernel handed to something unrelated answers `kill(pid, 0)` just
  // as a live runner would; the record's age is the independent fact.
  const ran = await runSchedule(fake.deps, { schedule: await onlySchedule(schedulesRoot), dryRun: false });
  assert.ok(ran.kind === "ran", `expected the stale lock to be reclaimed, got ${JSON.stringify(ran)}`);
});

test("a lock written before the current boot is stale; a fresh one is not", () => {
  const nowMs = Date.parse("2026-08-24T12:00:00Z");
  const bootTimeMs = Date.parse("2026-08-24T11:00:00Z");
  const probe = { nowMs, staleAfterMs: lockStaleAfterMs(2 * HOUR), bootTimeMs };
  assert.equal(isLockStale({ at: "2026-08-24T10:59:59Z" }, probe), true);
  assert.equal(isLockStale({ at: "2026-08-24T11:30:00Z" }, probe), false);
  assert.equal(isLockStale({ at: "not a date" }, probe), true);
  // With no boot time known, only the age rule applies.
  const ageOnly = { nowMs, staleAfterMs: HOUR, bootTimeMs: null };
  assert.equal(isLockStale({ at: new Date(nowMs - HOUR - 1).toISOString() }, ageOnly), true);
  assert.equal(isLockStale({ at: new Date(nowMs - 60_000).toISOString() }, ageOnly), false);
});

test("a tick that finds the tick lock held does not refresh the heartbeat", async () => {
  const { schedulesRoot } = await makeSchedule("tickjob", { yaml: BASE_YAML, run: "#!/bin/sh\necho ran\n" });
  const fake = await makeDeps({ schedulesRoot, nowMs: Date.parse("2026-08-24T12:00:00Z") });
  const first = await tick(fake.deps);
  assert.equal(first.exitCode, 0);

  // Another tick is in flight and hung: this one must not report health it did
  // not establish.
  await acquireLock(fake.deps.storeRoot, {
    name: ".tick",
    runId: "20260824-121500",
    pid: 4242,
    isProcessAlive: () => true,
    at: new Date(Date.parse("2026-08-24T12:15:00Z")),
    staleAfterMs: lockStaleAfterMs(2 * HOUR),
    bootTimeMs: null,
  });
  fake.setNow(Date.parse("2026-08-24T12:30:00Z"));
  const second = await tick(fake.deps);
  assert.equal(second.exitCode, 0);
  assert.ok(second.reports[0]?.kind === "skipped");

  const state = await readStoreState(fake.deps.storeRoot);
  assert.equal(state?.lastTickAt, "2026-08-24T12:00:00.000Z");
  assert.equal(state?.lastTickSkippedAt, "2026-08-24T12:30:00.000Z");
  assert.match(state?.lastTickSkippedReason ?? "", /pid 4242/u);
});

test("a reclaimed run whose handoff never reached a session is an important alert", async () => {
  const { schedulesRoot } = await makeSchedule("orphanjob", { yaml: BASE_YAML, run: "#!/bin/sh\necho ran\n" });
  const fake = await makeDeps({ schedulesRoot, nowMs: Date.parse("2026-08-24T12:00:00Z") });
  const store = fake.deps.storeRoot;
  await ensureStoreRoot(store);
  await fs.mkdir(path.join(store, "orphanjob", "runs"), { recursive: true });
  // The `run` script wrote its handoff; the runner was killed before it could
  // write the exit record, let alone start the session.
  await fs.writeFile(path.join(store, "orphanjob", "runs", "20260824-110000.handoff.json"), JSON.stringify({
    runId: "20260824-110000", title: "twelve exports", body: "remove them", at: "2026-08-24T11:00:00.000Z",
  }), "utf8");
  await acquireLock(store, {
    name: "orphanjob", runId: "20260824-110000", pid: 4242,
    isProcessAlive: () => true, at: new Date(),
    staleAfterMs: lockStaleAfterMs(2 * HOUR), bootTimeMs: null,
  });

  const deps = { ...fake.deps, isProcessAlive: () => false };
  const ran = await runSchedule(deps, { schedule: await onlySchedule(schedulesRoot), dryRun: false });
  assert.ok(ran.kind === "ran");
  const alerts = await readAlerts(store, "orphanjob");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.title, INTERRUPTED_HANDOFF_ALERT_TITLE);
  assert.equal(alerts[0]?.priority, "important");
  assert.match(alerts[0]?.message ?? "", /twelve exports/u);
});

test("a liveness guard that exits 0 with unparseable output reads as unknown", async () => {
  const { schedulesRoot } = await makeSchedule("livenessjob", { yaml: BASE_YAML, run: "#!/bin/sh\n" });
  const mainRoot = await tempDir("liveness-main");
  await fs.mkdir(path.join(mainRoot, "bin"), { recursive: true });
  const cli = path.join(mainRoot, "bin", "workstreams");
  // Exit 0 with a truncated answer: the shape that used to throw out of the
  // launcher instead of failing closed.
  await fs.writeFile(cli, '#!/bin/sh\nprintf \'{"ok":true,"paths":{\'\n', "utf8");
  await fs.chmod(cli, 0o755);
  const fake = await makeDeps({ schedulesRoot, nowMs: Date.parse("2026-08-24T12:00:00Z"), mainRoot });
  assert.equal(await agentState(fake.deps, "/tmp/some-worktree"), "unknown");
});

test("a registry completion the shell refuses is an important alert", async () => {
  const rig = await launchRig({
    name: "knip-sweep",
    yaml: workstreamYaml("  worktree: true"),
    run: HANDOFF_RUN,
    liveness: "none",
    agentExit: 0,
    // The session supersedes its own launch lease, which is what a concurrent
    // launch does; `complete_launch` then refuses the stale update.
    agentExtra: [
      REPORTS_DONE,
      `bash -c '. "${REPO}/bin/lib/session-registry.sh"; session_registry_begin_launch knip-sweep stolen-token "{}"' >/dev/null 2>&1`,
    ].join("\n"),
    check: null,
  });
  await withFakeAgent(rig, async () => runSchedule(rig.fake.deps, { schedule: rig.schedule, dryRun: false }));
  const alerts = await readAlerts(rig.fake.deps.storeRoot, "knip-sweep");
  const completion = alerts.find((alert) => alert.title === REGISTRY_COMPLETION_ALERT_TITLE);
  assert.ok(completion !== undefined, `expected a completion alert, got ${JSON.stringify(alerts.map((a) => a.title))}`);
  assert.equal(completion.priority, "important");
});

test("running a worktree:false schedule from a worktree is refused; --dry-run is not", async () => {
  const { schedulesRoot } = await makeSchedule("sdk-update", {
    yaml: workstreamYaml("  worktree: false"),
    run: "#!/bin/sh\n",
    prompt: "bin/schedules alert\n",
  });
  const schedule = await onlySchedule(schedulesRoot);
  const elsewhere = { schedule, repoRoot: "/checkouts/worktrees/x", mainRoot: "/checkouts/main", dryRun: false };
  assert.match(refuseRunHere(elsewhere) ?? "", /worktree: false/u);
  assert.equal(refuseRunHere({ ...elsewhere, dryRun: true }), null);
  assert.equal(refuseRunHere({ ...elsewhere, repoRoot: "/checkouts/main" }), null);

  const { schedulesRoot: wtRoot } = await makeSchedule("knip-sweep", {
    yaml: workstreamYaml("  worktree: true"),
    run: "#!/bin/sh\n",
    prompt: "bin/schedules alert\n",
  });
  assert.equal(refuseRunHere({ ...elsewhere, schedule: await onlySchedule(wtRoot) }), null);
});

test("a timeout kills the whole process group, not just the run script", async () => {
  const { schedulesRoot, dir } = await makeSchedule("grandchildjob", {
    yaml: 'description: "spawns"\ncadence: 1d\ntimeout: 1h\n',
    run: [
      "#!/bin/sh",
      // A grandchild is what a `run` script that shells out to pnpm leaves
      // behind: it survives a kill aimed at the script's own pid.
      'sh -c "sleep 45" &',
      'echo $! > "$SCHEDULE_STATE_DIR/grandchild.pid"',
      "sleep 45",
      "",
    ].join("\n"),
  });
  const fake = await makeDeps({ schedulesRoot, nowMs: Date.parse("2026-08-24T12:00:00Z") });
  const schedule = await onlySchedule(schedulesRoot);
  assert.equal(schedule.dir, dir);
  const startedMs = Date.now();
  const report = await runSchedule(fake.deps, {
    schedule: { ...schedule, config: { ...schedule.config, timeoutMs: 400 } },
    dryRun: false,
  });
  const elapsedMs = Date.now() - startedMs;
  assert.ok(report.kind === "ran" && report.timedOut);
  // A surviving grandchild holds the inherited pipes open, so the runner does
  // not even return until it exits on its own — the run after this one starts
  // late AND overlaps a process still writing the checkout.
  assert.ok(elapsedMs < 15_000, `the runner waited ${String(elapsedMs)}ms on a grandchild it should have killed`);
  const pid = Number((await fs.readFile(path.join(fake.deps.storeRoot, "grandchildjob", "grandchild.pid"), "utf8")).trim());
  assert.ok(Number.isInteger(pid) && pid > 1, "the run script should have recorded a grandchild pid");
  let alive = true;
  for (let attempt = 0; attempt < 40 && alive; attempt += 1) {
    await new Promise<void>((resolve) => { setTimeout(resolve, 50); });
    try {
      process.kill(pid, 0);
    } catch (_e) {
      /* ignore: ESRCH is the answer being waited for — the grandchild is gone */
      alive = false;
    }
  }
  assert.equal(alive, false, `grandchild ${String(pid)} outlived the timeout`);
});

test("execChild keeps only the tail of a noisy child in memory", async () => {
  const { schedulesRoot, dir } = await makeSchedule("noisyjob", {
    yaml: BASE_YAML,
    run: [
      "#!/bin/sh",
      "i=0",
      'while [ "$i" -lt 5000 ]; do echo "line-$i"; i=$((i + 1)); done',
      "",
    ].join("\n"),
  });
  assert.ok(schedulesRoot !== "");
  const result = await execChild({ file: path.join(dir, "run"), args: [] }, {
    cwd: dir,
    env: process.env,
    timeoutMs: 30_000,
    logFile: null,
    input: null,
  });
  assert.equal(result.exitCode, 0);
  const lines = result.output.split("\n").filter((line) => line !== "");
  assert.ok(lines.length <= OUTPUT_TAIL_LINES, `kept ${String(lines.length)} lines in memory`);
  assert.equal(lines.at(-1), "line-4999");
  assert.equal(result.output.includes("line-0\n"), false);
  assert.equal(result.logTruncated, false);
});

test("ensureStoreRoot claims an empty unmarked directory but refuses one with contents", async () => {
  const empty = path.join(await tempDir("store-empty"), "schedule-runs");
  await fs.mkdir(empty);
  await ensureStoreRoot(empty);
  await fs.stat(path.join(empty, ".schedule-runs"));

  const occupied = path.join(await tempDir("store-occupied"), "schedule-runs");
  await fs.mkdir(occupied);
  await fs.writeFile(path.join(occupied, "somebody-elses.txt"), "x", "utf8");
  await assert.rejects(ensureStoreRoot(occupied), /refusing to adopt/);
});

test("tickPath puts the installing node and the agent CLIs ahead of launchd's default PATH", () => {
  const p = tickPath({ execPath: "/opt/nvm/v24/bin/node", env: { PATH: "/x/agents:/usr/bin" } });
  assert.equal(p.split(":")[0], "/opt/nvm/v24/bin");
  assert.ok(p.split(":").includes("/usr/bin"));
  assert.ok(!p.includes("::"));
});
