/**
 * Track D chunk 1 of docs/plans/scheduled-workstreams.md: the `kind:
 * "scheduled"` registry field and everything that must branch on it — routing
 * state, prune, `list`, removal, `resume`.
 *
 *   node --import tsx --test bin/scheduled-workstreams-registry.test.ts
 *
 * Note on tier: bin/CLAUDE.md prefers doctests for new `bin/` tooling. The
 * plan names the Node test runner for this plan's chunks ("Tests first …
 * bin/schedules.test.ts", "`bin/router-*.test.ts`-style tests for the routing
 * table"), and `pnpm test` at the root runs exactly `bin/*.test.ts`.
 *
 * Real bash, real registry files in a temp state dir: what is under test is a
 * set of shell branches reading JSON records, and a TypeScript reimplementation
 * of them would test nothing.
 */

import assert from "node:assert/strict";
import { after, test } from "node:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execa } from "execa";

const BIN = import.meta.dirname;
const REPO = path.dirname(BIN);

const tempDirs: string[] = [];

after(async () => {
  for (const dir of tempDirs) await fs.rm(dir, { recursive: true, force: true });
});

interface Harness {
  /** CALLBACK_STATE_DIR: where `workstreams/<name>.json` records live. */
  stateDir: string;
  /** CALLBACK_WORKTREE_ROOT: kept empty, so every record reads as absent. */
  worktreeRoot: string;
  env: NodeJS.ProcessEnv;
}

async function harness(): Promise<Harness> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "scheduled-registry-"));
  tempDirs.push(root);
  const stateDir = path.join(root, "state");
  const worktreeRoot = path.join(root, "worktrees");
  await fs.mkdir(path.join(stateDir, "workstreams"), { recursive: true });
  await fs.mkdir(worktreeRoot, { recursive: true });
  return {
    stateDir,
    worktreeRoot,
    env: {
      ...process.env,
      CALLBACK_STATE_DIR: stateDir,
      CALLBACK_WORKTREE_ROOT: worktreeRoot,
      // No schedules directory here: `bin/schedules list --json` answers with an
      // empty listing, which is the join `list` must survive.
      CALLBACK_SCHEDULES_ROOT: path.join(root, "schedule-runs"),
    },
  };
}

async function writeRecord(place: Harness, entry: { name: string; record: unknown }): Promise<void> {
  await fs.writeFile(path.join(place.stateDir, "workstreams", `${entry.name}.json`), JSON.stringify(entry.record), "utf8");
}

/**
 * JSON a bash helper (or a registry file) printed. The shell is the parse
 * boundary here, and the caller names the shape it is about to assert on — a
 * mismatch surfaces as the failing assertion, which is what the test is for.
 */
function shellJson<T>(text: string): T {
  const value: T = JSON.parse(text);
  return value;
}

async function recordNames(place: Harness): Promise<string[]> {
  const files = await fs.readdir(path.join(place.stateDir, "workstreams"));
  return files.filter((file) => file.endsWith(".json")).map((file) => file.replace(/\.json$/u, "")).toSorted();
}

/** Run a bash snippet with the teardown lib (and everything it sources) loaded. */
async function bash(script: string, place: Harness): Promise<string> {
  const result = await execa(
    "bash",
    ["-c", `set -u\n. "${BIN}/lib/worktree-teardown.sh"\nwt_paths_init "${REPO}" >/dev/null\n${script}`],
    { env: place.env, reject: false },
  );
  assert.equal(result.exitCode, 0, `bash failed: ${result.stderr}`);
  return result.stdout;
}

const SCHEDULED = { kind: "scheduled", agent: "claude", branch: "worktree-knip-sweep" };

// ─── Routing ──────────────────────────────────────────────────────────────

async function routing(place: Harness, input: { exists: boolean; agentState: string; record: unknown }): Promise<{ state: string; action: string }> {
  const out = await bash(
    `. "${BIN}/lib/workstream-routing.sh"\n`
    + `workstream_routing_json ${String(input.exists)} ${input.agentState} `
    + `'${JSON.stringify(input.record)}' "" "" 1800000000`,
    place,
  );
  return shellJson<{ state: string; action: string }>(out);
}

test("a scheduled record with no live agent routes to scheduled/resume-with-briefing", async () => {
  const place = await harness();
  assert.deepEqual(
    await routing(place, { exists: false, agentState: "none", record: SCHEDULED }),
    { state: "scheduled", action: "resume-with-briefing", lastActivityAt: null },
  );
});

test("a scheduled record whose worktree exists and is idle still routes as scheduled", async () => {
  const place = await harness();
  const result = await routing(place, { exists: true, agentState: "none", record: SCHEDULED });
  assert.equal(result.state, "scheduled");
  assert.equal(result.action, "resume-with-briefing");
});

test("a live agent wins over the scheduled record", async () => {
  const place = await harness();
  assert.deepEqual(
    await routing(place, { exists: true, agentState: "live", record: SCHEDULED }),
    { state: "live", action: "manual-forward", lastActivityAt: null },
  );
});

test("unknown liveness wins over the scheduled record (fail-closed)", async () => {
  const place = await harness();
  assert.deepEqual(
    await routing(place, { exists: true, agentState: "unknown", record: SCHEDULED }),
    { state: "uncertain", action: "investigate", lastActivityAt: null },
  );
});

test("a launch in flight on a scheduled record still routes as launching", async () => {
  const place = await harness();
  const startedAt = new Date(1800000000_000 - 60_000).toISOString().replace(/\.\d{3}Z$/u, "Z");
  const result = await routing(place, {
    exists: false,
    agentState: "launching",
    record: { ...SCHEDULED, launch: { token: "t1", startedAt, failedAt: null, failureReason: null } },
  });
  assert.equal(result.state, "launching");
  assert.equal(result.action, "wait-for-launch");
});

test("an unscheduled record is unaffected by the new branch", async () => {
  const place = await harness();
  const result = await routing(place, { exists: false, agentState: "none", record: { agent: "claude" } });
  assert.equal(result.state, "uncertain");
});

// ─── The schedule join ────────────────────────────────────────────────────

const SCHEDULES_JSON = JSON.stringify({
  lastTickAt: "2026-08-24T12:00:00Z",
  schedules: [{
    name: "knip-sweep",
    description: "Unused exports",
    cadence: "7d",
    enabled: true,
    lastRunAt: "2026-08-20T03:00:00Z",
    lastOutcome: "handoff",
    nextDueAt: "2026-08-27T03:00:00Z",
    due: false,
    overdue: true,
    openAlerts: 2,
  }],
  invalid: [],
});

async function scheduleRow(place: Harness, name: string): Promise<unknown> {
  const out = await bash(`. "${BIN}/lib/workstream-routing.sh"\nworkstream_schedule_row '${SCHEDULES_JSON}' ${name}`, place);
  return shellJson<unknown>(out);
}

test("the schedule row projects the scheduler's entry plus the tick heartbeat", async () => {
  const place = await harness();
  assert.deepEqual(await scheduleRow(place, "knip-sweep"), {
    cadence: "7d",
    enabled: true,
    lastRunAt: "2026-08-20T03:00:00Z",
    lastOutcome: "handoff",
    overdue: true,
    nextDueAt: "2026-08-27T03:00:00Z",
    openAlerts: 2,
    heartbeat: { lastTickAt: "2026-08-24T12:00:00Z" },
  });
});

test("a workstream the scheduler does not know gets a null schedule", async () => {
  const place = await harness();
  assert.equal(await scheduleRow(place, "some-feature"), null);
});

// ─── Prune ────────────────────────────────────────────────────────────────

test("prune keeps a scheduled record and still drops an old removed one", async () => {
  const place = await harness();
  await writeRecord(place, { name: "knip-sweep", record: SCHEDULED });
  await writeRecord(place, { name: "old-thing", record: { agent: "claude", removed: { at: "2020-01-01T00:00:00Z", merged: true } } });
  await bash("session_registry_prune \"$(date +%s)\"", place);
  assert.deepEqual(await recordNames(place), ["knip-sweep"]);
});

test("prune keeps a scheduled record whose launch failed long ago", async () => {
  const place = await harness();
  await writeRecord(place, {
    name: "knip-sweep",
    record: {
      ...SCHEDULED,
      launch: { token: "t1", startedAt: "2020-01-01T00:00:00Z", failedAt: "2020-01-01T00:05:00Z", failureReason: "boom" },
    },
  });
  await bash("session_registry_prune \"$(date +%s)\"", place);
  assert.deepEqual(await recordNames(place), ["knip-sweep"]);
});

test("session_registry_mark_scheduled makes an existing record scheduled", async () => {
  const place = await harness();
  await writeRecord(place, { name: "knip-sweep", record: { agent: "claude" } });
  await bash("session_registry_mark_scheduled knip-sweep", place);
  const record = shellJson<{ kind: string; agent: string }>(
    await fs.readFile(path.join(place.stateDir, "workstreams", "knip-sweep.json"), "utf8"),
  );
  assert.equal(record.kind, "scheduled");
  assert.equal(record.agent, "claude");
});

// ─── Removal ──────────────────────────────────────────────────────────────

test("removing a scheduled workstream drops the launch lease and sets no removed block", async () => {
  const place = await harness();
  const patch = shellJson<{ launch: null; removed?: unknown }>(await bash(
    `wt_removal_patch '${JSON.stringify(SCHEDULED)}' 2026-08-24T00:00:00Z abc123 keep/x true`,
    place,
  ));
  assert.equal(patch.launch, null);
  // `removed` is what would hide the record from `list` and route it as
  // removed; the cull is recorded under `culled` instead (next test).
  assert.equal(patch.removed, undefined);
});

test("a culled scheduled record keeps the tip it was culled at, for the resume briefing", async () => {
  const place = await harness();
  const patch = shellJson<{ launch: null; culled: { at: string; merged: boolean; finalSha: string } }>(await bash(
    `wt_removal_patch '${JSON.stringify(SCHEDULED)}' 2026-08-24T00:00:00Z abc123 keep/x true`,
    place,
  ));
  assert.deepEqual(patch.culled, { at: "2026-08-24T00:00:00Z", merged: true, finalSha: "abc123" });
});

test("a culled record is still scheduled, not removed: routing, resume and prune are unchanged", async () => {
  const place = await harness();
  const culled = { ...SCHEDULED, launch: null, culled: { at: "2026-08-24T00:00:00Z", merged: true, finalSha: "abc123" } };
  assert.equal((await routing(place, { exists: false, agentState: "none", record: culled })).state, "scheduled");
  assert.equal(await resumeState(place, culled), "scheduled");
  await writeRecord(place, { name: "knip-sweep", record: culled });
  await bash("session_registry_prune \"$(date +%s)\"", place);
  assert.deepEqual(await recordNames(place), ["knip-sweep"]);
});

test("resume recovers the landed-since tip from `culled` for a schedule and `removed` for everything else", async () => {
  const place = await harness();
  const sha = async (record: unknown): Promise<string> =>
    bash(`. "${BIN}/lib/workstream-resume.sh"\nworkstream_recovery_sha '${JSON.stringify(record)}'`, place);
  assert.equal(await sha({ ...SCHEDULED, culled: { at: "x", merged: true, finalSha: "abc123" } }), "abc123");
  assert.equal(await sha({ agent: "claude", removed: { at: "x", merged: true, finalSha: "def456" } }), "def456");
  assert.equal(await sha(SCHEDULED), "");
});

test("removing an ordinary workstream still records the removal", async () => {
  const place = await harness();
  const patch = shellJson<{ removed: { at: string; merged: boolean; finalSha: string; boxRef: string } }>(await bash(
    "wt_removal_patch '{\"agent\":\"claude\"}' 2026-08-24T00:00:00Z abc123 keep/x false",
    place,
  ));
  assert.deepEqual(patch.removed, { at: "2026-08-24T00:00:00Z", merged: false, finalSha: "abc123", boxRef: "keep/x" });
});

// ─── Resume ───────────────────────────────────────────────────────────────

async function resumeState(place: Harness, record: unknown): Promise<string> {
  return bash(`. "${BIN}/lib/workstream-resume.sh"\nworkstream_resume_state false none '${JSON.stringify(record)}'`, place);
}

test("an absent scheduled record resumes rather than reporting an unknown workstream", async () => {
  const place = await harness();
  assert.equal(await resumeState(place, SCHEDULED), "scheduled");
});

test("a removed scheduled record keeps the removed-unmerged recovery gate", async () => {
  const place = await harness();
  assert.equal(
    await resumeState(place, { ...SCHEDULED, removed: { at: "2026-08-24T00:00:00Z", merged: false } }),
    "removed-unmerged",
  );
});

// ─── list / archive ───────────────────────────────────────────────────────

interface ListRow {
  name: string;
  path: string | null;
  routing: { state: string; action: string };
  schedule: unknown;
}

async function list(place: Harness): Promise<ListRow[]> {
  const result = await execa(path.join(BIN, "workstreams"), ["list", "--json"], { env: place.env, reject: false });
  assert.equal(result.exitCode, 0, `list failed: ${result.stderr}`);
  return shellJson<ListRow[]>(result.stdout);
}

test("list renders an absent scheduled record that no launch is in flight for", async () => {
  const place = await harness();
  await writeRecord(place, { name: "knip-sweep", record: SCHEDULED });
  await writeRecord(place, { name: "plain-dormant", record: { agent: "claude" } });
  const rows = await list(place);
  assert.deepEqual(rows.map((row) => row.name), ["knip-sweep"]);
  assert.equal(rows[0]?.path, null);
  assert.equal(rows[0]?.routing.state, "scheduled");
});

test("every row carries a schedule field, null when the name is not a schedule", async () => {
  const place = await harness();
  // A sticky record whose `schedules/<name>/` is gone — the record outlives the
  // directory by design, so this is the shape that has to render with no
  // schedule data rather than crash. (Any name that IS enrolled would join
  // against the real schedule and report its cadence.)
  await writeRecord(place, { name: "retired-sweep", record: SCHEDULED });
  const rows = await list(place);
  assert.equal(rows[0]?.schedule, null);
});

test("archive refuses a scheduled record and points at schedule.yaml", async () => {
  const place = await harness();
  await writeRecord(place, { name: "knip-sweep", record: SCHEDULED });
  const result = await execa(path.join(BIN, "workstreams"), ["archive", "knip-sweep"], { env: place.env, reject: false });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /set `enabled: false` in schedule\.yaml instead/u);
});
