/**
 * Track C: the alert records and the reporting CLI (`alert`, `done`, `ack`,
 * `handoff`) a schedule's run script and its agent session call.
 *
 *   node --import tsx --test bin/schedules-cli.test.ts
 *
 * Split out of bin/schedules.test.ts; fixtures are bin/schedules-test-support.ts.
 */

import assert from "node:assert/strict";
import { after, test } from "node:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  ACK_FADE_MS,
  readAlerts,
  visibleAlerts,
  writeAlert,
} from "./lib/schedules-store.js";
import { DRY_RUN_HANDOFF_MARKER } from "./lib/schedules-runner.js";
import { raiseAlert } from "./lib/schedules-alerts.js";
import {
  BASE_YAML,
  HOUR,
  cleanupTempDirs,
  makeDeps,
  makeSchedule,
  runCli,
  tempDir,
} from "./schedules-test-support.js";

after(cleanupTempDirs);

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
  assert.match(alert.id, /^\d{8}-\d{6}-[\da-f]{4}$/);
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
  assert.deepEqual(visibleAlerts(all, nowMs).map((alert) => alert.id).toSorted(), ["a-open", "b-recent"]);
});

test("alert takes its workstream and run id from the environment, and --run overrides", async () => {
  const storeRoot = path.join(await tempDir("cli-store"), "store");
  const env = { BBX_SCHEDULES_ROOT: storeRoot, SCHEDULE_NAME: "clijob", SCHEDULE_RUN_ID: "20260824-120000" };

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
    env: { BBX_SCHEDULES_ROOT: storeRoot, SCHEDULE_NAME: "", SCHEDULE_RUN_ID: "" },
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /SCHEDULE_RUN_ID/);
});

test("--details - reads the long tail from stdin", async () => {
  const storeRoot = path.join(await tempDir("cli-store"), "store");
  const env = { BBX_SCHEDULES_ROOT: storeRoot, SCHEDULE_NAME: "stdinjob", SCHEDULE_RUN_ID: "20260824-120000" };
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
  const env = { BBX_SCHEDULES_ROOT: storeRoot, SCHEDULE_NAME: "ackjob", SCHEDULE_RUN_ID: "20260824-120000" };
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
      BBX_SCHEDULES_ROOT: storeRoot,
      SCHEDULE_NAME: "dryjob",
      SCHEDULE_RUN_ID: "20260824-120000",
      SCHEDULE_DRY_RUN: "1",
    },
    input: "twelve exports\n",
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.includes(DRY_RUN_HANDOFF_MARKER), result.stdout);
  await assert.rejects(fs.stat(storeRoot), /ENOENT/);
});
