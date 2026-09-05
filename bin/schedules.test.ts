/**
 * Tests for the schedules schema, loader, store, and runner. Every row in the
 * plan's Failure-modes table that says "test" maps to one named test here.
 *
 * Note on tier: bin/CLAUDE.md prefers doctests for new `bin/` tooling, but the
 * plan's rollout ("Tests first … bin/schedules.test.ts (Node test runner) is
 * written per chunk before the code") names this file explicitly, and `pnpm
 * test` at the root runs exactly `bin/*.test.ts`.
 *
 *   node --import tsx --test bin/schedules.test.ts
 *
 * Real subprocesses and a real temp store: what is being tested is a script
 * being executed with an environment and a lock, which a fake would not
 * exercise. The clock, the PID-liveness probe, and the notifier are injected.
 */

import assert from "node:assert/strict";
import { after, test } from "node:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  loadSchedule,
  parseDuration,
  resolveScheduleConfig,
  scheduleYamlSchema,
} from "./lib/schedules.js";
import {
  acquireLock,
  ensureStoreRoot,
  lockStaleAfterMs,
  readAlerts,
  readScheduleState,
  readStoreState,
} from "./lib/schedules-store.js";
import {
  DRY_RUN_HANDOFF_MARKER,
  classifyOutcome,
  isDue,
  isOverdue,
  runSchedule,
} from "./lib/schedules-runner.js";
import { tick } from "./lib/schedules-tick.js";
import {
  BASE_YAML,
  DAY,
  HOUR,
  cleanupTempDirs,
  config,
  makeDeps,
  makeSchedule,
  onlySchedule,
  stateAt,
} from "./schedules-test-support.js";

after(cleanupTempDirs);

// ─── Track A: schema + loader ─────────────────────────────────────────────

test("cadence parsing accepts <n>h|d|w and refuses everything else", () => {
  assert.equal(parseDuration("2h"), 2 * HOUR);
  assert.equal(parseDuration("7d"), 7 * DAY);
  assert.equal(parseDuration("1w"), 7 * DAY);
  for (const bad of ["7days", "0d", "d", "1m", "-1d", "1.5d", ""]) {
    assert.throws(() => parseDuration(bad), /not a duration/, `expected '${bad}' to be refused`);
  }
});

test("a bad cadence spelling is a Zod issue naming the field, not a crash", async () => {
  const { schedulesRoot } = await makeSchedule("bad", { yaml: 'description: "x"\ncadence: 7days\n', run: "#!/bin/sh\n" });
  const entry = await loadSchedule(path.join(schedulesRoot, "bad"));
  assert.equal(entry.kind, "invalid");
  assert.ok(entry.kind === "invalid" && entry.issues.some((issue) => issue.path.includes("cadence")));
});

test("grace defaults to 25% of cadence and timeout to 2h; enabled defaults true", () => {
  const parsed = scheduleYamlSchema.parse({ description: "x", cadence: "4d" });
  const resolved = resolveScheduleConfig(parsed);
  assert.equal(resolved.graceMs, DAY);
  assert.equal(resolved.timeoutMs, 2 * HOUR);
  assert.equal(resolved.enabled, true);
  assert.equal(resolved.workstream, null);
});

test("local.yaml overrides only the keys it declares", async () => {
  const { schedulesRoot } = await makeSchedule("overridden", {
    yaml: 'description: "base"\ncadence: 7d\nenabled: true\n',
    local: "enabled: false\n",
    run: "#!/bin/sh\n",
  });
  const entry = await onlySchedule(schedulesRoot);
  assert.equal(entry.config.enabled, false);
  assert.equal(entry.config.cadenceMs, 7 * DAY);
  assert.equal(entry.config.description, "base");
});

test("a missing or non-executable run is invalid", async () => {
  const missing = await makeSchedule("norun", { yaml: BASE_YAML });
  const missingEntry = await loadSchedule(path.join(missing.schedulesRoot, "norun"));
  assert.ok(missingEntry.kind === "invalid" && missingEntry.issues.some((issue) => issue.path === "run"));

  const unreadable = await makeSchedule("nomode", { yaml: BASE_YAML, run: "#!/bin/sh\n", runMode: 0o644 });
  const modeEntry = await loadSchedule(path.join(unreadable.schedulesRoot, "nomode"));
  assert.ok(modeEntry.kind === "invalid" && modeEntry.issues.some((issue) => issue.path === "run"));
});

const WORKSTREAM_YAML = `description: "with a workstream"
cadence: 7d
workstream:
  agent: claude
  model: opus
  worktree: true
  session: fresh
  permissionMode: bypassPermissions
`;

test("prompt.md is required when the schedule declares a workstream", async () => {
  const without = await makeSchedule("ws", { yaml: WORKSTREAM_YAML, run: "#!/bin/sh\n" });
  const entry = await loadSchedule(path.join(without.schedulesRoot, "ws"));
  assert.ok(entry.kind === "invalid" && entry.issues.some((issue) => issue.path === "prompt.md"));

  const withPrompt = await makeSchedule("ws", { yaml: WORKSTREAM_YAML, run: "#!/bin/sh\n", prompt: "run bin/schedules alert\n" });
  const ok = await loadSchedule(path.join(withPrompt.schedulesRoot, "ws"));
  assert.equal(ok.kind, "ok");
});

test("permissionMode has no default: a workstream without it is invalid", async () => {
  const yaml = WORKSTREAM_YAML.replace("  permissionMode: bypassPermissions\n", "");
  const { schedulesRoot } = await makeSchedule("nomode", { yaml, run: "#!/bin/sh\n", prompt: "x" });
  const entry = await loadSchedule(path.join(schedulesRoot, "nomode"));
  assert.ok(entry.kind === "invalid" && entry.issues.some((issue) => issue.path.includes("permissionMode")));
});

// ─── Track B: due-ness, locks, outcomes ───────────────────────────────────

test("due-ness: never run is due, elapsed cadence is due, fresh is not, disabled never is", () => {
  const nowMs = Date.parse("2026-08-24T12:00:00Z");
  assert.equal(isDue({ config: config({}), state: stateAt(null) }, nowMs), true);
  assert.equal(isDue({ config: config({}), state: stateAt(new Date(nowMs - DAY - 1).toISOString()) }, nowMs), true);
  assert.equal(isDue({ config: config({}), state: stateAt(new Date(nowMs - HOUR).toISOString()) }, nowMs), false);
  assert.equal(isDue({ config: config({ enabled: false }), state: stateAt(null) }, nowMs), false);
});

test("overdue needs cadence PLUS grace, and a never-run schedule is due but not overdue", () => {
  const nowMs = Date.parse("2026-08-24T12:00:00Z");
  const cfg = config({ cadenceMs: DAY, graceMs: 6 * HOUR });
  assert.equal(isOverdue({ config: cfg, state: stateAt(null) }, nowMs), false);
  assert.equal(isOverdue({ config: cfg, state: stateAt(new Date(nowMs - DAY - HOUR).toISOString()) }, nowMs), false);
  assert.equal(isOverdue({ config: cfg, state: stateAt(new Date(nowMs - DAY - 7 * HOUR).toISOString()) }, nowMs), true);
});

test("outcome classification: clean, handoff, and handoff-with-nonzero-exit is failed", () => {
  assert.equal(classifyOutcome({ exitCode: 0, hasHandoff: false }), "clean");
  assert.equal(classifyOutcome({ exitCode: 0, hasHandoff: true }), "handoff");
  assert.equal(classifyOutcome({ exitCode: 3, hasHandoff: true }), "failed");
  assert.equal(classifyOutcome({ exitCode: null, hasHandoff: false }), "failed");
});

test("a clean run stamps state and writes a log; a failed run raises an important alert with the log tail", async () => {
  const clean = await makeSchedule("cleanjob", { yaml: BASE_YAML, run: "#!/bin/sh\necho hello\n" });
  const cleanFake = await makeDeps({ schedulesRoot: clean.schedulesRoot, nowMs: Date.parse("2026-08-24T12:00:00Z") });
  const cleanReport = await runSchedule(cleanFake.deps, { schedule: await onlySchedule(clean.schedulesRoot), dryRun: false });
  assert.ok(cleanReport.kind === "ran" && cleanReport.outcome === "clean");
  const state = await readScheduleState(cleanFake.deps.storeRoot, "cleanjob");
  assert.equal(state.lastRunAt, "2026-08-24T12:00:00.000Z");
  assert.equal(state.lastOutcome, "clean");
  assert.equal(cleanFake.notifications.length, 0);

  const failing = await makeSchedule("failjob", { yaml: BASE_YAML, run: "#!/bin/sh\necho boom >&2\nexit 3\n" });
  const failFake = await makeDeps({ schedulesRoot: failing.schedulesRoot, nowMs: Date.parse("2026-08-24T12:00:00Z") });
  const failReport = await runSchedule(failFake.deps, { schedule: await onlySchedule(failing.schedulesRoot), dryRun: false });
  assert.ok(failReport.kind === "ran" && failReport.outcome === "failed");
  const alerts = await readAlerts(failFake.deps.storeRoot, "failjob");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.priority, "important");
  assert.match(alerts[0]?.details ?? "", /boom/);
  // Delivery is best-effort but attempted: the record plus one notification.
  assert.equal(failFake.notifications.length, 1);
});

test("a run that writes a handoff is classified handoff and the handoff is readable", async () => {
  const script = [
    "#!/bin/sh",
    'printf \'{"runId":"%s","title":"work","body":"do it","at":"2026-08-24T12:00:00.000Z"}\\n\' "$SCHEDULE_RUN_ID" \\',
    '  > "$SCHEDULE_STATE_DIR/runs/$SCHEDULE_RUN_ID.handoff.json"',
    "",
  ].join("\n");
  const { schedulesRoot } = await makeSchedule("handoffjob", { yaml: BASE_YAML, run: script });
  const fake = await makeDeps({ schedulesRoot, nowMs: Date.parse("2026-08-24T12:00:00Z") });
  const report = await runSchedule(fake.deps, { schedule: await onlySchedule(schedulesRoot), dryRun: false });
  assert.ok(report.kind === "ran", `unexpected report ${JSON.stringify(report)}`);
  assert.equal(report.outcome, "handoff");
  assert.equal(report.handoff?.title, "work");
});

test("a run that overruns its timeout is killed and reads as failed", async () => {
  const { schedulesRoot } = await makeSchedule("slowjob", {
    yaml: 'description: "slow"\ncadence: 1d\ntimeout: 1h\n',
    run: "#!/bin/sh\nsleep 30\n",
  });
  const fake = await makeDeps({ schedulesRoot, nowMs: Date.parse("2026-08-24T12:00:00Z") });
  const schedule = await onlySchedule(schedulesRoot);
  const report = await runSchedule(fake.deps, {
    schedule: { ...schedule, config: { ...schedule.config, timeoutMs: 150 } },
    dryRun: false,
  });
  assert.ok(report.kind === "ran" && report.timedOut && report.outcome === "failed");
});

test("a held lock skips the run; a lock owned by a dead pid is reclaimed", async () => {
  const { schedulesRoot } = await makeSchedule("lockjob", { yaml: BASE_YAML, run: "#!/bin/sh\necho ran\n" });
  const fake = await makeDeps({ schedulesRoot, nowMs: Date.parse("2026-08-24T12:00:00Z") });
  const schedule = await onlySchedule(schedulesRoot);

  // Seeded by hand, so the store gets its marker the way the CLI's entry
  // points write it.
  await ensureStoreRoot(fake.deps.storeRoot);
  await fs.mkdir(path.join(fake.deps.storeRoot, "lockjob", "runs"), { recursive: true });
  const held = await acquireLock(fake.deps.storeRoot, {
    name: "lockjob",
    runId: "20260824-110000",
    pid: 4242,
    isProcessAlive: () => true,
    at: new Date(),
    staleAfterMs: lockStaleAfterMs(2 * HOUR),
    bootTimeMs: null,
  });
  assert.equal(held.kind, "acquired");

  const skipped = await runSchedule(fake.deps, { schedule, dryRun: false });
  assert.ok(skipped.kind === "skipped" && skipped.reason.includes("4242"));

  // Same lock, owner now dead: the next attempt reclaims it and runs.
  const reclaimFake = { ...fake.deps, storeRoot: fake.deps.storeRoot, isProcessAlive: () => false };
  const ran = await runSchedule(reclaimFake, { schedule, dryRun: false });
  assert.ok(ran.kind === "ran" && ran.outcome === "clean");
});

test("--dry-run runs the script with SCHEDULE_DRY_RUN=1 and writes nothing", async () => {
  const script = [
    "#!/bin/sh",
    'test "$SCHEDULE_DRY_RUN" = "1" || { echo "dry-run flag missing"; exit 9; }',
    `echo "${DRY_RUN_HANDOFF_MARKER} twelve exports"`,
    "",
  ].join("\n");
  const { schedulesRoot } = await makeSchedule("dryjob", { yaml: BASE_YAML, run: script });
  const fake = await makeDeps({ schedulesRoot, nowMs: Date.parse("2026-08-24T12:00:00Z") });
  const report = await runSchedule(fake.deps, { schedule: await onlySchedule(schedulesRoot), dryRun: true });
  assert.ok(report.kind === "dry-run", `unexpected report ${JSON.stringify(report)}`);
  assert.equal(report.outcome, "handoff");
  assert.match(report.output, /twelve exports/);
  await assert.rejects(fs.stat(fake.deps.storeRoot), /ENOENT/);
});

// ─── Track B: the tick ────────────────────────────────────────────────────

test("tick stamps the heartbeat BEFORE any schedule runs, and runs only what is due", async () => {
  // The script copies the store-root state.json it can see at run time; if the
  // heartbeat were stamped afterwards the copy would be missing.
  const script = [
    "#!/bin/sh",
    'cp "$SCHEDULE_STATE_DIR/../state.json" "$SCHEDULE_STATE_DIR/seen-heartbeat.json"',
    "",
  ].join("\n");
  const { schedulesRoot } = await makeSchedule("heartbeatjob", { yaml: BASE_YAML, run: script });
  await fs.mkdir(path.join(schedulesRoot, "off"), { recursive: true });
  await fs.writeFile(path.join(schedulesRoot, "off", "schedule.yaml"), 'description: "off"\ncadence: 1d\nenabled: false\n', "utf8");
  await fs.writeFile(path.join(schedulesRoot, "off", "run"), "#!/bin/sh\nexit 1\n", "utf8");
  await fs.chmod(path.join(schedulesRoot, "off", "run"), 0o755);

  const fake = await makeDeps({ schedulesRoot, nowMs: Date.parse("2026-08-24T12:00:00Z") });
  const result = await tick(fake.deps);
  assert.equal(result.exitCode, 0);
  assert.equal(result.reports.length, 1);

  const seen = await fs.readFile(path.join(fake.deps.storeRoot, "heartbeatjob", "seen-heartbeat.json"), "utf8");
  assert.match(seen, /"lastTickAt": "2026-08-24T12:00:00.000Z"/);
  const storeState = await readStoreState(fake.deps.storeRoot);
  assert.equal(storeState?.lastTickExit, 0);

  // A second tick in the same minute: nothing is due any more.
  fake.setNow(Date.parse("2026-08-24T12:05:00Z"));
  const second = await tick(fake.deps);
  assert.equal(second.reports.length, 0);
});

test("tick that cannot write the store exits non-zero and notifies", async () => {
  const { schedulesRoot } = await makeSchedule("anyjob", { yaml: BASE_YAML, run: "#!/bin/sh\n" });
  const fake = await makeDeps({ schedulesRoot, nowMs: Date.parse("2026-08-24T12:00:00Z") });
  // An existing directory with contents and no marker is somebody else's
  // data: refused. (Empty is claimed — see ensureStoreRoot.)
  await fs.mkdir(fake.deps.storeRoot, { recursive: true });
  await fs.writeFile(path.join(fake.deps.storeRoot, "theirs.txt"), "", "utf8");
  const result = await tick(fake.deps);
  assert.equal(result.exitCode, 1);
  assert.ok(result.heartbeatError !== null);
  assert.equal(fake.notifications.length, 1);
  assert.equal(fake.notifications[0]?.title, "beebox schedules");
  assert.match(fake.notifications[0]?.message ?? "", /^cannot write the schedule store:/);
  assert.equal(fake.notifications[0]?.group, "schedule-store-failure");
  assert.equal(fake.notifications[0]?.destination, "http://localhost:3210/workstreams/streams");
});
