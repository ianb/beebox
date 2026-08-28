/**
 * The launch, end to end against a fake agent: the worktree, the briefing on
 * stdin, both exit records, and every way a session can fail to report.
 *
 *   node --import tsx --test bin/schedules-launch.test.ts
 *
 * Split out of bin/schedules.test.ts; fixtures are bin/schedules-test-support.ts.
 */

import assert from "node:assert/strict";
import { after, test } from "node:test";
import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { execa } from "execa";

import {
  acquireLock,
  ensureStoreRoot,
  lockStaleAfterMs,
  readAlerts,
  readScheduleState,
} from "./lib/schedules-store.js";
import { runSchedule } from "./lib/schedules-runner.js";
import {
  HANDOFF_RUN,
  HOUR,
  REPO,
  REPORTS_DONE,
  cleanupTempDirs,
  hasLines,
  launchRig,
  shellJson,
  useTempRegistryStateDir,
  withFakeAgent,
  workstreamYaml,
} from "./schedules-test-support.js";

after(cleanupTempDirs);
await useTempRegistryStateDir();

test("a handoff starts the session in the worktree, on stdin, and records both exits", async () => {
  const rig = await launchRig({
    name: "knip-sweep",
    yaml: workstreamYaml("  worktree: true"),
    run: HANDOFF_RUN,
    liveness: "none",
    agentExit: 0,
    agentExtra: REPORTS_DONE,
    check: "#!/bin/sh\nexit 0\n",
  });
  const report = await withFakeAgent(rig, async () => runSchedule(rig.fake.deps, { schedule: rig.schedule, dryRun: false }));
  assert.ok(report.kind === "ran" && report.outcome === "handoff");

  const seen = await rig.transcript();
  // realpath: macOS resolves /var to /private/var for a child's $PWD.
  assert.ok(hasLines(seen, [`cwd=${await fs.realpath(rig.worktreePath)}`]), seen);
  assert.match(seen, /^name=knip-sweep$/mu);
  assert.match(seen, /^arg=--append-system-prompt-file$/mu);
  // The briefing is the handoff body plus the trailer that names the run id and
  // the reporting contract — the prompt is never an argv element.
  assert.match(seen, /^briefing<<$/mu);
  assert.match(seen, /remove them/u);
  assert.ok(seen.includes(`bin/schedules alert --run ${report.runId}`), seen);
  assert.ok(seen.includes(`bin/schedules done --run ${report.runId}`), seen);

  const exit = shellJson<{ runExit: number; sessionExit: number; checkExit: number; sessionLaunched: boolean }>(await fs.readFile(
    path.join(rig.fake.deps.storeRoot, "knip-sweep", "runs", `${report.runId}.exit.json`), "utf8",
  ));
  assert.deepEqual(
    { runExit: exit.runExit, sessionExit: exit.sessionExit, checkExit: exit.checkExit, sessionLaunched: exit.sessionLaunched },
    { runExit: 0, sessionExit: 0, checkExit: 0, sessionLaunched: true },
  );
  // A session that reported has nothing to alert about.
  assert.deepEqual(await readAlerts(rig.fake.deps.storeRoot, "knip-sweep"), []);
});

test("worktree: false runs the session in the main checkout and never creates a worktree", async () => {
  const rig = await launchRig({
    name: "sdk-update",
    yaml: workstreamYaml("  worktree: false"),
    run: HANDOFF_RUN,
    // The stand-in `workstreams` exits 64 for anything but create/agent-liveness;
    // a `worktree: false` schedule must call neither.
    liveness: "live",
    agentExit: 0,
    agentExtra: REPORTS_DONE,
    check: null,
  });
  const report = await withFakeAgent(rig, async () => runSchedule(rig.fake.deps, { schedule: rig.schedule, dryRun: false }));
  assert.ok(report.kind === "ran" && report.outcome === "handoff");
  assert.ok(hasLines(await rig.transcript(), [`cwd=${await fs.realpath(rig.fake.deps.mainRoot)}`]), rig.worktreePath);
});

test("a live or unknown agent in the worktree refuses the launch and alerts normal", async () => {
  for (const state of ["live", "launching", "unknown"]) {
    const rig = await launchRig({
      name: "knip-sweep",
      yaml: workstreamYaml("  worktree: true"),
      run: HANDOFF_RUN,
      liveness: state,
      agentExit: 0,
      agentExtra: REPORTS_DONE,
      check: null,
    });
    await withFakeAgent(rig, async () => runSchedule(rig.fake.deps, { schedule: rig.schedule, dryRun: false }));
    assert.equal(await rig.transcript(), "", `${state} should not have started an agent`);
    const [alert] = await readAlerts(rig.fake.deps.storeRoot, "knip-sweep");
    assert.equal(alert?.priority, "normal");
    assert.equal(alert?.title, "work waiting, session already live");
  }
});

test("the worktree is brought up to date with main before the session starts", async () => {
  const rig = await launchRig({
    name: "knip-sweep",
    yaml: workstreamYaml("  worktree: true"),
    run: HANDOFF_RUN,
    liveness: "none",
    agentExit: 0,
    agentExtra: REPORTS_DONE,
    check: null,
  });

  // Stand the worktree up ahead of the run — `create` only re-attaches when it
  // already exists, which is the long-lived shape a schedule resumes into.
  // Give `main` a commit the schedule's own branch does not have.
  const wt = rig.worktreePath;
  await fs.mkdir(wt, { recursive: true });
  const git = (...args: string[]) => execa("git", ["-C", wt, "-c", "user.email=t@t", "-c", "user.name=t", ...args]);
  await git("init", "-q", "-b", "main");
  await git("commit", "-q", "--allow-empty", "-m", "init");
  await fs.writeFile(path.join(wt, "from-main.txt"), "landed elsewhere\n", "utf8");
  await git("add", "from-main.txt");
  await git("commit", "-q", "-m", "a commit only main has");
  await git("checkout", "-q", "-b", "worktree-knip-sweep", "HEAD~1");

  assert.equal(existsSync(path.join(wt, "from-main.txt")), false, "precondition: the branch lacks main's commit");

  await withFakeAgent(rig, async () => runSchedule(rig.fake.deps, { schedule: rig.schedule, dryRun: false }));

  assert.ok(await rig.transcript(), "the session should have started");
  assert.equal(
    existsSync(path.join(wt, "from-main.txt")),
    true,
    "the runner should have merged main into the branch before launching",
  );
});

test("a session that ends without reporting is an important alert with the log tail", async () => {
  const rig = await launchRig({
    name: "knip-sweep",
    yaml: workstreamYaml("  worktree: true"),
    run: HANDOFF_RUN,
    liveness: "none",
    agentExit: 0,
    agentExtra: 'echo "I did some things and wandered off"',
    check: null,
  });
  await withFakeAgent(rig, async () => runSchedule(rig.fake.deps, { schedule: rig.schedule, dryRun: false }));
  const [alert] = await readAlerts(rig.fake.deps.storeRoot, "knip-sweep");
  assert.equal(alert?.priority, "important");
  assert.equal(alert?.title, "session ended without reporting");
  assert.match(alert?.details ?? "", /wandered off/u);
});

test("a session reporting through the real `bin/schedules done` counts as reported", async () => {
  const rig = await launchRig({
    name: "knip-sweep",
    yaml: workstreamYaml("  worktree: true"),
    run: HANDOFF_RUN,
    liveness: "none",
    agentExit: 0,
    agentExtra: `cd "${REPO}" && CALLBACK_SCHEDULES_ROOT="__STORE__" "${REPO}/bin/schedules" done --run "$SCHEDULE_RUN_ID"`,
    check: null,
  });
  // The store path is only known after the rig exists; patch it into the fake.
  for (const name of ["claude", "codex"]) {
    const file = path.join(rig.binDir, name);
    const text = await fs.readFile(file, "utf8");
    await fs.writeFile(file, text.replace("__STORE__", rig.fake.deps.storeRoot), "utf8");
  }
  await withFakeAgent(rig, async () => runSchedule(rig.fake.deps, { schedule: rig.schedule, dryRun: false }));
  assert.deepEqual(await readAlerts(rig.fake.deps.storeRoot, "knip-sweep"), []);
});

test("a non-zero check is an important alert even when the session reported", async () => {
  const rig = await launchRig({
    name: "manual-tests",
    yaml: workstreamYaml("  worktree: true"),
    run: HANDOFF_RUN,
    liveness: "none",
    agentExit: 0,
    agentExtra: REPORTS_DONE,
    check: "#!/bin/sh\necho 'the triage edited a closed issue' >&2\nexit 4\n",
  });
  const report = await withFakeAgent(rig, async () => runSchedule(rig.fake.deps, { schedule: rig.schedule, dryRun: false }));
  assert.ok(report.kind === "ran");
  const [alert] = await readAlerts(rig.fake.deps.storeRoot, "manual-tests");
  assert.equal(alert?.priority, "important");
  assert.equal(alert?.title, "the post-session check failed");
  const exit = shellJson<{ checkExit: number }>(await fs.readFile(
    path.join(rig.fake.deps.storeRoot, "manual-tests", "runs", `${report.runId}.exit.json`), "utf8",
  ));
  assert.equal(exit.checkExit, 4);
});

test("a persistent schedule keeps its minted claude session id in state.json", async () => {
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
  assert.ok(state.sessionId !== null && state.sessionId.length > 0);
  // First run: the id has no transcript yet, so it is minted rather than resumed.
  const seen = await rig.transcript();
  assert.ok(hasLines(seen, ["arg=--session-id", `arg=${state.sessionId}`]), seen);
});

test("a lock reclaimed from a dead runner still accounts for the session that never reported", async () => {
  const rig = await launchRig({
    name: "knip-sweep",
    yaml: workstreamYaml("  worktree: true"),
    run: "#!/bin/sh\nexit 0\n",
    liveness: "none",
    agentExit: 0,
    agentExtra: REPORTS_DONE,
    check: null,
  });
  const store = rig.fake.deps.storeRoot;
  // A run that launched a session and left no result: the laptop went down.
  await ensureStoreRoot(store);
  await fs.mkdir(path.join(store, "knip-sweep", "runs"), { recursive: true });
  await fs.writeFile(path.join(store, "knip-sweep", "runs", "20260824-110000.log"), "the session was cut off\n", "utf8");
  await fs.writeFile(path.join(store, "knip-sweep", "runs", "20260824-110000.exit.json"), JSON.stringify({
    runId: "20260824-110000", runExit: 0, sessionExit: null, checkExit: null,
    sessionLaunched: true, timedOut: false, at: "2026-08-24T11:00:00.000Z",
  }), "utf8");
  await acquireLock(store, {
    name: "knip-sweep", runId: "20260824-110000", pid: 4242,
    isProcessAlive: () => true, at: new Date(),
    staleAfterMs: lockStaleAfterMs(2 * HOUR), bootTimeMs: null,
  });

  const deps = { ...rig.fake.deps, isProcessAlive: () => false };
  await withFakeAgent(rig, async () => runSchedule(deps, { schedule: rig.schedule, dryRun: false }));
  const alerts = await readAlerts(store, "knip-sweep");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.title, "session ended without reporting");
  assert.equal(alerts[0]?.runId, "20260824-110000");
});
