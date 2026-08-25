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
import { tickPath } from "./lib/schedules-launchd.js";
import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execa } from "execa";

import {
  loadSchedule,
  loadSchedules,
  parseDuration,
  resolveScheduleConfig,
  scheduleYamlSchema,
  type LoadedSchedule,
  type ScheduleConfig,
} from "./lib/schedules.js";
import {
  ACK_FADE_MS,
  acquireLock,
  ensureStoreRoot,
  isLockStale,
  lockStaleAfterMs,
  readAlerts,
  readScheduleState,
  readStoreState,
  visibleAlerts,
  writeAlert,
} from "./lib/schedules-store.js";
import {
  DRY_RUN_HANDOFF_MARKER,
  INTERRUPTED_HANDOFF_ALERT_TITLE,
  classifyOutcome,
  isDue,
  isOverdue,
  refuseRunHere,
  runSchedule,
  tick,
} from "./lib/schedules-runner.js";
import { OUTPUT_TAIL_LINES, execChild } from "./lib/schedules-exec.js";
import { REGISTRY_COMPLETION_ALERT_TITLE, agentState } from "./lib/schedules-workstream.js";
import { raiseAlert, type RunnerDeps } from "./lib/schedules-alerts.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

after(async () => {
  for (const dir of tempDirs) await fs.rm(dir, { recursive: true, force: true });
});

const HOUR = 3600_000;
const DAY = 24 * HOUR;

interface FixtureOptions {
  yaml: string;
  /** Body of the `run` script; omitted means no `run` file at all. */
  run?: string;
  runMode?: number;
  local?: string;
  prompt?: string;
}

/** One `schedules/<name>/` directory inside a fresh schedules root. */
async function makeSchedule(name: string, options: FixtureOptions): Promise<{ schedulesRoot: string; dir: string }> {
  const schedulesRoot = await tempDir("schedules-src");
  const dir = path.join(schedulesRoot, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "schedule.yaml"), options.yaml, "utf8");
  if (options.run !== undefined) {
    const script = path.join(dir, "run");
    await fs.writeFile(script, options.run, "utf8");
    await fs.chmod(script, options.runMode ?? 0o755);
  }
  if (options.local !== undefined) await fs.writeFile(path.join(dir, "local.yaml"), options.local, "utf8");
  if (options.prompt !== undefined) await fs.writeFile(path.join(dir, "prompt.md"), options.prompt, "utf8");
  return { schedulesRoot, dir };
}

const BASE_YAML = 'description: "A test schedule"\ncadence: 1d\n';

interface Fake {
  deps: RunnerDeps;
  notifications: { title: string; message: string }[];
  setNow: (ms: number) => void;
}

async function makeDeps(input: { schedulesRoot: string; nowMs: number; alive?: (pid: number) => boolean; mainRoot?: string; bootTimeMs?: number }): Promise<Fake> {
  const storeRoot = path.join(await tempDir("schedule-runs"), "store");
  const notifications: { title: string; message: string }[] = [];
  let nowMs = input.nowMs;
  return {
    notifications,
    setNow: (ms) => { nowMs = ms; },
    deps: {
      storeRoot,
      schedulesRoot: input.schedulesRoot,
      repoRoot: input.schedulesRoot,
      mainRoot: input.mainRoot ?? input.schedulesRoot,
      now: () => new Date(nowMs),
      pid: process.pid,
      isProcessAlive: input.alive ?? (() => true),
      bootTimeMs: () => input.bootTimeMs ?? null,
      notify: async (notification) => { notifications.push(notification); await Promise.resolve(); },
    },
  };
}

function config(overrides: Partial<ScheduleConfig>): ScheduleConfig {
  return {
    description: "test",
    cadenceMs: DAY,
    graceMs: 6 * HOUR,
    enabled: true,
    timeoutMs: 2 * HOUR,
    workstream: null,
    ...overrides,
  };
}

function stateAt(lastRunAt: string | null): { lastRunAt: string | null; lastRunId: string | null; lastExit: number | null; lastOutcome: null; sessionId: null } {
  return { lastRunAt, lastRunId: null, lastExit: null, lastOutcome: null, sessionId: null };
}

async function onlySchedule(schedulesRoot: string): Promise<LoadedSchedule> {
  const entries = await loadSchedules(schedulesRoot);
  const [entry] = entries;
  assert.ok(entry !== undefined && entry.kind === "ok", `expected one valid schedule, got ${JSON.stringify(entries)}`);
  return entry;
}

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
  // data: refused. (Empty is adopted — see ensureStoreRoot.)
  await fs.mkdir(fake.deps.storeRoot, { recursive: true });
  await fs.writeFile(path.join(fake.deps.storeRoot, "theirs.txt"), "", "utf8");
  const result = await tick(fake.deps);
  assert.equal(result.exitCode, 1);
  assert.ok(result.heartbeatError !== null);
  assert.equal(fake.notifications.length, 1);
});

// ─── Track C: alerts ──────────────────────────────────────────────────────

test("an alert record carries the full shape and defaults to open", async () => {
  const { schedulesRoot } = await makeSchedule("alertjob", { yaml: BASE_YAML, run: "#!/bin/sh\n" });
  const fake = await makeDeps({ schedulesRoot, nowMs: Date.parse("2026-08-24T22:01:02Z") });
  const alert = await raiseAlert(fake.deps, {
    workstream: "alertjob",
    runId: "20260824-220100",
    title: "12 new unused exports",
    message: "knip found twelve.",
    details: "- a\n- b\n",
    priority: "normal",
  });
  assert.equal(alert.state, "open");
  assert.equal(alert.acknowledgedAt, null);
  assert.equal(alert.runId, "20260824-220100");
  assert.match(alert.id, /^\d{8}-\d{6}-[0-9a-f]{4}$/);
  const stored = await readAlerts(fake.deps.storeRoot, "alertjob");
  assert.deepEqual(stored, [alert]);
});

test("acknowledged alerts leave the default view after 14 days; records are kept", async () => {
  const nowMs = Date.parse("2026-08-24T12:00:00Z");
  const { schedulesRoot } = await makeSchedule("fadejob", { yaml: BASE_YAML, run: "#!/bin/sh\n" });
  const fake = await makeDeps({ schedulesRoot, nowMs });
  const base = {
    workstream: "fadejob",
    runId: null,
    title: "t",
    message: "m",
    details: null,
    priority: "normal" as const,
    createdAt: new Date(nowMs).toISOString(),
  };
  await fs.mkdir(path.join(fake.deps.storeRoot, "fadejob", "alerts"), { recursive: true });
  await writeAlert(fake.deps.storeRoot, { ...base, id: "a-open", state: "open", acknowledgedAt: null });
  await writeAlert(fake.deps.storeRoot, {
    ...base, id: "b-recent", state: "acknowledged", acknowledgedAt: new Date(nowMs - ACK_FADE_MS + HOUR).toISOString(),
  });
  await writeAlert(fake.deps.storeRoot, {
    ...base, id: "c-faded", state: "acknowledged", acknowledgedAt: new Date(nowMs - ACK_FADE_MS - HOUR).toISOString(),
  });
  const all = await readAlerts(fake.deps.storeRoot, "fadejob");
  assert.equal(all.length, 3);
  assert.deepEqual(visibleAlerts(all, nowMs).map((alert) => alert.id).sort(), ["a-open", "b-recent"]);
});

// ─── Track C: the reporting CLI ───────────────────────────────────────────

const CLI = path.resolve(import.meta.dirname, "schedules.ts");

interface CliRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[], options: { env: NodeJS.ProcessEnv; input?: string }): Promise<CliRun> {
  const result = await execa("node", ["--import", "tsx", CLI, ...args], {
    reject: false,
    env: { ...process.env, SCHEDULE_NOTIFY: "0", ...options.env },
    cwd: path.dirname(path.dirname(CLI)),
    ...(options.input === undefined ? {} : { input: options.input }),
  });
  return { exitCode: result.exitCode ?? -1, stdout: result.stdout, stderr: result.stderr };
}

test("alert takes its workstream and run id from the environment, and --run overrides", async () => {
  const storeRoot = path.join(await tempDir("cli-store"), "store");
  const env = { CALLBACK_SCHEDULES_ROOT: storeRoot, SCHEDULE_NAME: "clijob", SCHEDULE_RUN_ID: "20260824-120000" };

  const fromEnv = await runCli(["alert", "--title", "from env", "--message", "m"], { env });
  assert.equal(fromEnv.exitCode, 0, fromEnv.stderr);

  const overridden = await runCli(
    ["alert", "--title", "overridden", "--message", "m", "--run", "20260824-999999", "--priority", "backlog"],
    { env },
  );
  assert.equal(overridden.exitCode, 0, overridden.stderr);

  const alerts = await readAlerts(storeRoot, "clijob");
  assert.equal(alerts.length, 2);
  const byTitle = new Map(alerts.map((alert) => [alert.title, alert]));
  assert.equal(byTitle.get("from env")?.runId, "20260824-120000");
  assert.equal(byTitle.get("overridden")?.runId, "20260824-999999");
  assert.equal(byTitle.get("overridden")?.priority, "backlog");
  // `alert` also files the run's result record, so a bailed run is detectable.
  const result = await fs.readFile(path.join(storeRoot, "clijob", "runs", "20260824-120000.result.json"), "utf8");
  assert.match(result, /"kind": "alert"/);
});

test("alert refuses with neither --run nor SCHEDULE_RUN_ID", async () => {
  const storeRoot = path.join(await tempDir("cli-store"), "store");
  const result = await runCli(["alert", "--title", "t", "--message", "m", "--workstream", "clijob"], {
    env: { CALLBACK_SCHEDULES_ROOT: storeRoot, SCHEDULE_NAME: "", SCHEDULE_RUN_ID: "" },
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /SCHEDULE_RUN_ID/);
});

test("--details - reads the long tail from stdin", async () => {
  const storeRoot = path.join(await tempDir("cli-store"), "store");
  const env = { CALLBACK_SCHEDULES_ROOT: storeRoot, SCHEDULE_NAME: "stdinjob", SCHEDULE_RUN_ID: "20260824-120000" };
  const result = await runCli(["alert", "--title", "t", "--message", "m", "--details", "-"], {
    env,
    input: "line one\nline two\n",
  });
  assert.equal(result.exitCode, 0, result.stderr);
  const [alert] = await readAlerts(storeRoot, "stdinjob");
  assert.match(alert?.details ?? "", /line two/);
});

test("done records a result; ack marks an alert acknowledged", async () => {
  const storeRoot = path.join(await tempDir("cli-store"), "store");
  const env = { CALLBACK_SCHEDULES_ROOT: storeRoot, SCHEDULE_NAME: "ackjob", SCHEDULE_RUN_ID: "20260824-120000" };
  const done = await runCli(["done"], { env });
  assert.equal(done.exitCode, 0, done.stderr);
  const result = await fs.readFile(path.join(storeRoot, "ackjob", "runs", "20260824-120000.result.json"), "utf8");
  assert.match(result, /"kind": "done"/);

  const alerted = await runCli(["alert", "--title", "t", "--message", "m"], { env });
  const id = alerted.stdout.trim();
  const acked = await runCli(["ack", id], { env });
  assert.equal(acked.exitCode, 0, acked.stderr);
  const [alert] = await readAlerts(storeRoot, "ackjob");
  assert.equal(alert?.state, "acknowledged");
  assert.ok(alert?.acknowledgedAt !== null);
});

test("handoff under SCHEDULE_DRY_RUN=1 prints instead of writing", async () => {
  const storeRoot = path.join(await tempDir("cli-store"), "store");
  const result = await runCli(["handoff", "--title", "work", "--body", "-"], {
    env: {
      CALLBACK_SCHEDULES_ROOT: storeRoot,
      SCHEDULE_NAME: "dryjob",
      SCHEDULE_RUN_ID: "20260824-120000",
      SCHEDULE_DRY_RUN: "1",
    },
    input: "twelve exports\n",
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, new RegExp(DRY_RUN_HANDOFF_MARKER.replace(/[[\]]/g, "\\$&")));
  await assert.rejects(fs.stat(storeRoot), /ENOENT/);
});

// ─── Track B chunk 2: starting the workstream ─────────────────────────────

/** Where the REAL session-registry.sh writes during these tests: the launch
 *  lease is part of what is under test, so the shell library runs for real
 *  against a temp state dir rather than being stood in for. */
const registryStateDir = await tempDir("schedules-registry");
process.env["CALLBACK_STATE_DIR"] = registryStateDir;

const REPO = path.dirname(import.meta.dirname);
const LAUNCH_HEADLESS = path.join(import.meta.dirname, "lib", "launch-headless.sh");
const REAL_PATH = process.env["PATH"] ?? "";

/** The agent command as the one shell library assembles it. */
async function headlessArgv(env: NodeJS.ProcessEnv): Promise<{ exitCode: number; argv: string[]; stderr: string }> {
  const result = await execa(LAUNCH_HEADLESS, [], { reject: false, env: { ...process.env, ...env } });
  return {
    exitCode: result.exitCode ?? -1,
    argv: result.stdout.split("\n").filter((line) => line !== ""),
    stderr: result.stderr,
  };
}

const CLAUDE_ENV = {
  LH_AGENT: "claude",
  LH_WORKSTREAM: "knip-sweep",
  LH_MODEL: "opus",
  LH_PERMISSION_MODE: "dontAsk",
  LH_SYSTEM_PROMPT_FILE: path.join(REPO, "package.json"),
  LH_SESSION: "fresh",
};

test("the claude command carries the sandbox, the prompt file, and a fresh session", async () => {
  const built = await headlessArgv({
    ...CLAUDE_ENV,
    LH_TOOLS: "Read\nGrep\nEdit",
    LH_ALLOWED_TOOLS: "Edit(issues/**)\nRead(bin/**)",
    LH_DISALLOWED_TOOLS: "Read(private-issues/**)",
    LH_MAX_BUDGET_USD: "2",
  });
  assert.equal(built.exitCode, 0, built.stderr);
  assert.deepEqual(built.argv, [
    "claude", "-p", "--brief", "--name", "knip-sweep", "--model", "opus",
    "--permission-mode", "dontAsk", "--setting-sources", "user", "--disable-slash-commands",
    "--append-system-prompt-file", path.join(REPO, "package.json"),
    "--tools", "Read", "Grep", "Edit",
    "--allowedTools", "Edit(issues/**)", "Read(bin/**)",
    "--disallowedTools", "Read(private-issues/**)",
    "--max-budget-usd", "2",
    "--no-session-persistence",
  ]);
});

test("effort rides the claude command and is refused for codex", async () => {
  const built = await headlessArgv({ ...CLAUDE_ENV, LH_EFFORT: "high" });
  assert.equal(built.exitCode, 0, built.stderr);
  assert.deepEqual(built.argv.slice(0, 9), [
    "claude", "-p", "--brief", "--name", "knip-sweep", "--model", "opus", "--effort", "high",
  ]);
  // Absent means absent: the CLI's own default is what an unstated effort means.
  const bare = await headlessArgv({ ...CLAUDE_ENV, LH_EFFORT: "" });
  assert.equal(bare.argv.includes("--effort"), false);

  const codex = await headlessArgv({
    LH_AGENT: "codex", LH_WORKSTREAM: "sdk-update", LH_PERMISSION_MODE: "dontAsk",
    LH_SESSION: "fresh", LH_CWD: "/tmp/wt", LH_EFFORT: "max",
  });
  assert.notEqual(codex.exitCode, 0);
  assert.match(codex.stderr, /no equivalent for: effort/u);
});

test("a persistent claude session mints an id on the first run and resumes it afterwards", async () => {
  const first = await headlessArgv({ ...CLAUDE_ENV, LH_SESSION: "persistent", LH_SESSION_ID: "abc-123", LH_SESSION_RESUME: "0" });
  assert.deepEqual(first.argv.slice(-2), ["--session-id", "abc-123"]);
  const later = await headlessArgv({ ...CLAUDE_ENV, LH_SESSION: "persistent", LH_SESSION_ID: "abc-123", LH_SESSION_RESUME: "1" });
  assert.deepEqual(later.argv.slice(-2), ["--resume", "abc-123"]);
  const refused = await headlessArgv({ ...CLAUDE_ENV, LH_SESSION: "persistent" });
  assert.notEqual(refused.exitCode, 0);
  assert.match(refused.stderr, /LH_SESSION_ID is required/u);
});

test("the codex command maps the sandbox and refuses constraints it cannot honor", async () => {
  const bypass = await headlessArgv({
    LH_AGENT: "codex", LH_WORKSTREAM: "sdk-update", LH_MODEL: "gpt-5.6-sol",
    LH_PERMISSION_MODE: "bypassPermissions", LH_SESSION: "fresh", LH_CWD: "/tmp/wt",
  });
  assert.equal(bypass.exitCode, 0, bypass.stderr);
  assert.deepEqual(bypass.argv, [
    "codex", "exec", "-s", "danger-full-access",
    "-c", 'projects."/tmp/wt".trust_level="trusted"', "-c", "project_doc_max_bytes=131072",
    "-m", "gpt-5.6-sol",
  ]);

  const resumed = await headlessArgv({
    LH_AGENT: "codex", LH_WORKSTREAM: "sdk-update", LH_PERMISSION_MODE: "dontAsk",
    LH_SESSION: "persistent", LH_SESSION_RESUME: "1", LH_CWD: "/tmp/wt",
  });
  assert.deepEqual(resumed.argv.slice(0, 6), ["codex", "exec", "resume", "--last", "-s", "workspace-write"]);

  // A declared sandbox codex cannot express is a refusal, never a silently
  // unconstrained agent.
  const constrained = await headlessArgv({
    LH_AGENT: "codex", LH_WORKSTREAM: "sdk-update", LH_PERMISSION_MODE: "dontAsk",
    LH_SESSION: "fresh", LH_CWD: "/tmp/wt", LH_ALLOWED_TOOLS: "Edit(issues/**)", LH_MAX_BUDGET_USD: "2",
  });
  assert.notEqual(constrained.exitCode, 0);
  assert.match(constrained.stderr, /no equivalent for: allowedTools maxBudgetUsd/u);
});

// ─── The launch, end to end against a fake agent ──────────────────────────

const HANDOFF_RUN = [
  "#!/bin/sh",
  'printf \'{"runId":"%s","title":"twelve exports","body":"remove them","at":"2026-08-24T12:00:00.000Z"}\\n\' "$SCHEDULE_RUN_ID" \\',
  '  > "$SCHEDULE_STATE_DIR/runs/$SCHEDULE_RUN_ID.handoff.json"',
  "",
].join("\n");

function workstreamYaml(fields: string): string {
  return [
    'description: "a schedule with an agent"',
    "cadence: 1d",
    "workstream:",
    "  agent: claude",
    "  model: opus",
    "  session: fresh",
    "  permissionMode: bypassPermissions",
    fields,
    "",
  ].join("\n");
}

interface Rig {
  fake: Fake;
  schedule: LoadedSchedule;
  worktreePath: string;
  binDir: string;
  /** Everything the fake agent saw: argv, cwd, environment, briefing. */
  transcript: () => Promise<string>;
}

/**
 * A schedule whose agent is a shell script that records what it was given.
 * Nothing here launches a real agent — but `bin/workstreams` is only stood in
 * for because creating a real worktree costs ten seconds and a git mutation;
 * the registry, the store, the launch-headless assembly, and the process
 * plumbing are all the shipping ones.
 */
async function launchRig(input: {
  name: string;
  yaml: string;
  run: string;
  liveness: string;
  agentExit: number;
  agentExtra: string;
  check: string | null;
}): Promise<Rig> {
  const { schedulesRoot, dir } = await makeSchedule(input.name, {
    yaml: input.yaml,
    run: input.run,
    prompt: "You are the test agent. Finish with bin/schedules alert or done.\n",
  });
  if (input.check !== null) {
    const check = path.join(dir, "check");
    await fs.writeFile(check, input.check, "utf8");
    await fs.chmod(check, 0o755);
  }

  const mainRoot = await tempDir("main-checkout");
  const worktreePath = path.join(await tempDir("worktrees"), input.name);
  await fs.mkdir(path.join(mainRoot, "bin"), { recursive: true });
  const workstreams = path.join(mainRoot, "bin", "workstreams");
  await fs.writeFile(workstreams, [
    "#!/bin/sh",
    "case \"$1\" in",
    // A real worktree is a git worktree, and the runner brings it up to date
    // with `main` before launching. Make the fake one an actual repo on `main`
    // so that merge is exercised rather than sidestepped.
    `  create) mkdir -p "${worktreePath}";`,
    `    if [ ! -e "${worktreePath}/.git" ]; then`,
    `      git -C "${worktreePath}" init -q -b main;`,
    `      git -C "${worktreePath}" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init;`,
    `    fi;`,
    `    printf '%s\\n' "${worktreePath}" ;;`,
    `  agent-liveness) printf '{"ok":true,"paths":{"%s":{"state":"${input.liveness}","reason":"fake"}}}\\n' "$2" ;;`,
    "  *) echo \"unexpected: $*\" >&2; exit 64 ;;",
    "esac",
    "",
  ].join("\n"), "utf8");
  await fs.chmod(workstreams, 0o755);

  const binDir = await tempDir("fake-agent-bin");
  const agentLog = path.join(binDir, "transcript.txt");
  const script = [
    "#!/bin/sh",
    "{",
    "  printf 'cwd=%s\\n' \"$PWD\"",
    "  printf 'name=%s\\n' \"$SCHEDULE_NAME\"",
    "  printf 'runid=%s\\n' \"$SCHEDULE_RUN_ID\"",
    "  printf 'statedir=%s\\n' \"$SCHEDULE_STATE_DIR\"",
    "  for a in \"$@\"; do printf 'arg=%s\\n' \"$a\"; done",
    "  printf 'briefing<<\\n'",
    "  cat",
    `} > "${agentLog}"`,
    input.agentExtra,
    `exit ${String(input.agentExit)}`,
    "",
  ].join("\n");
  for (const name of ["claude", "codex"]) {
    const file = path.join(binDir, name);
    await fs.writeFile(file, script, "utf8");
    await fs.chmod(file, 0o755);
  }

  const fake = await makeDeps({ schedulesRoot, nowMs: Date.parse("2026-08-24T12:00:00Z"), mainRoot });
  return {
    fake,
    schedule: await onlySchedule(schedulesRoot),
    worktreePath,
    binDir,
    transcript: async () => {
      try {
        return await fs.readFile(agentLog, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
        throw e;
      }
    },
  };
}

/** The fake agent is found the way the real one is: by name, on PATH. */
async function withFakeAgent<T>(rig: Rig, body: () => Promise<T>): Promise<T> {
  process.env["PATH"] = `${rig.binDir}:${REAL_PATH}`;
  try {
    return await body();
  } finally {
    process.env["PATH"] = REAL_PATH;
  }
}

const REPORTS_DONE = [
  'printf \'{"runId":"%s","kind":"done","alertId":null,"at":"2026-08-24T12:00:00.000Z"}\\n\' "$SCHEDULE_RUN_ID" \\',
  '  > "$SCHEDULE_STATE_DIR/runs/$SCHEDULE_RUN_ID.result.json"',
].join("\n");

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
  assert.match(seen, new RegExp(`^cwd=${await fs.realpath(rig.worktreePath)}$`, "mu"));
  assert.match(seen, /^name=knip-sweep$/mu);
  assert.match(seen, /^arg=--append-system-prompt-file$/mu);
  // The briefing is the handoff body plus the trailer that names the run id and
  // the reporting contract — the prompt is never an argv element.
  assert.match(seen, /^briefing<<$/mu);
  assert.match(seen, /remove them/u);
  assert.match(seen, new RegExp(`bin/schedules alert --run ${report.runId}`, "u"));
  assert.match(seen, new RegExp(`bin/schedules done --run ${report.runId}`, "u"));

  const exit = JSON.parse(await fs.readFile(
    path.join(rig.fake.deps.storeRoot, "knip-sweep", "runs", `${report.runId}.exit.json`), "utf8",
  )) as { runExit: number; sessionExit: number; checkExit: number; sessionLaunched: boolean };
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
  assert.match(await rig.transcript(), new RegExp(`^cwd=${await fs.realpath(rig.fake.deps.mainRoot)}$`, "mu"));
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
  const exit = JSON.parse(await fs.readFile(
    path.join(rig.fake.deps.storeRoot, "manual-tests", "runs", `${report.runId}.exit.json`), "utf8",
  )) as { checkExit: number };
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
  assert.match(seen, new RegExp(`^arg=--session-id\\narg=${state.sessionId}$`, "mu"));
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
    } catch {
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

test("tickPath puts the installing node and the agent CLIs ahead of launchd's default PATH", () => {
  const p = tickPath({ execPath: "/opt/nvm/v24/bin/node", env: { PATH: "/x/agents:/usr/bin" } });
  assert.equal(p.split(":")[0], "/opt/nvm/v24/bin");
  assert.ok(p.split(":").includes("/usr/bin"));
  assert.ok(!p.includes("::"));
});

test("ensureStoreRoot adopts an empty unmarked directory and refuses a non-empty one", async () => {
  const empty = await fs.mkdtemp(path.join(os.tmpdir(), "sched-empty-"));
  await ensureStoreRoot(empty);
  await fs.stat(path.join(empty, ".schedule-runs"));
  const full = await fs.mkdtemp(path.join(os.tmpdir(), "sched-full-"));
  await fs.writeFile(path.join(full, "somebody-elses.txt"), "", "utf8");
  await assert.rejects(ensureStoreRoot(full), /refusing to adopt/);
});
