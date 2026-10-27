// # The scheduler pass's job check, on a real box
//
// `checkWaitingJobs` (`src/core/schedule/job-check/core.ts`) runs once per pass.
// It starts one full wakeup when an unscoped normal-priority job whose card is
// committed is due, no wakeup is running, and the daily bound allows it. It
// records each attempt in `.beebox/job-check.json` and writes each decision to
// `scheduler.jsonl`. The starter is injected here; it answers as the box
// server or the daemon would. See docs/plans/on-demand-job-triggers.md, Track B.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { createHash } from "node:crypto";
import { appendFile, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox, type TmpBox } from "../../../helpers/test-helpers.js";
import { checkWaitingJobs, type JobCheckStart } from "../../../../src/core/schedule/job-check/core.js";
import { jobCheckStatePath, readJobCheckState } from "../../../../src/core/schedule/job-check/state.js";
import { boxLogFile } from "../../../../src/core/schedule/box-log.js";
import { boxLocalDay } from "../../../../src/core/box/local-day.js";
import { acquireLock, releaseLock } from "../../../../src/lib/file-lock.js";
import { wakeupCycleLockPath } from "../../../../src/cli/commands/wakeup/cycle-lock.js";
import { isRecord } from "../../../../src/shared/is-record.js";

const T0 = "2026-10-27T12:00:00.000Z";
const HOUR = 60 * 60 * 1000;
const JOB = "_bookkeeping/jobs/2026-10-27-color.question-followup.job.card";
const FILE = "2026-10-27-color.question-followup.job.card";
const CARD = "---\npriority: normal\ndescription: Follow up on the color question\n---\n";

function setTime(iso: string): void {
  process.env.BBX_TIME = iso;
}
const later = (ms: number): string => new Date(Date.parse(T0) + ms).toISOString();

/** A starter that answers `answer` (or throws) and counts its calls. */
function starter(answer: JobCheckStart["state"] | "throws") {
  const calls: string[] = [];
  return {
    calls,
    start: (boxRoot: string): Promise<JobCheckStart> => {
      calls.push(boxRoot);
      if (answer === "throws") return Promise.reject(new Error("The box's server could not be reached"));
      return Promise.resolve({ state: answer, detail: answer === "started" ? "" : `answered ${answer}` });
    },
  };
}

/** The job-check lines in the box's scheduler log, without their timestamp and box. */
async function jobCheckLog(box: TmpBox): Promise<unknown[]> {
  let text: string;
  try {
    text = await readFile(boxLogFile(box.root), "utf-8");
  } catch (_e) {
    /* ignore: no log yet means no lines */
    return [];
  }
  return text.trim().split("\n").flatMap((line) => {
    const entry: unknown = JSON.parse(line);
    if (!isRecord(entry) || entry.event !== "job-check") return [];
    const { ts: _ts, box: _box, event: _event, ...rest } = entry;
    return [rest];
  });
}

async function committedJobBox(t: Test): Promise<TmpBox> {
  const box = await makeTmpBox({ git: true });
  setTime(T0);
  t.teardown(async () => {
    delete process.env.BBX_TIME;
    await box.cleanup();
  });
  await box.write(JOB, CARD);
  box.commitAll("answer: write follow-up job");
  return box;
}

// ## A committed follow-up job starts one run
//
// The run is stamped: one attempt, next due in an hour, one run today. The
// next pass, a minute later, finds the job backing off and starts nothing.
void test("A committed follow-up job starts one run", async (t) => {
  const box = await committedJobBox(t);
  const s = starter("started");

  const first = await checkWaitingJobs(box.root, { start: s.start });
  setTime(later(60_000));
  const second = await checkWaitingJobs(box.root, { start: s.start });
  t.check({ first, second, calls: s.calls, state: (await readJobCheckState(box.root)).state, log: await jobCheckLog(box) }, {
    first: { kind: "started", files: [FILE] },
    second: { kind: "none-due" },
    calls: [box.root],
    state: {
      day: await boxLocalDay(box.root, new Date(T0)),
      runsToday: 1,
      boundLoggedDay: null,
      jobs: { [FILE]: { firstSeenAt: T0, hash: createHash("sha256").update(CARD).digest("hex"), attempts: 1, nextAt: later(HOUR), givenUp: false } },
    },
    log: [{ action: "started", files: [FILE], runsToday: 1 }],
  });

  // ## A finished job's entry is pruned
  //
  // The run's agent finishes the job (the card is deleted and committed); the
  // next pass finds nothing waiting and drops the entry.
  await rm(join(box.root, JOB));
  box.commitAll("finish job");
  t.check([await checkWaitingJobs(box.root, { start: s.start }), (await readJobCheckState(box.root)).state.jobs], [{ kind: "idle" }, {}]);
});

// ## Only committed content counts
//
// An uncommitted edit to a tracked job, or a card that was never added, is a
// write in progress or a rejected commit: it starts nothing. Once committed,
// the job starts one run.
void test("Only committed content counts", async (t) => {
  const box = await committedJobBox(t);
  await appendFile(join(box.root, JOB), "One more item.\n");
  await box.write("_bookkeeping/jobs/never-added.intake.job.card", CARD);
  const s = starter("started");

  const dirty = await checkWaitingJobs(box.root, { start: s.start });
  await rm(join(box.root, "_bookkeeping/jobs/never-added.intake.job.card"));
  box.commitAll("commit the edit");
  const committed = await checkWaitingJobs(box.root, { start: s.start });
  t.check({ dirty, committed, calls: s.calls }, {
    dirty: { kind: "none-due" },
    committed: { kind: "started", files: [FILE] },
    calls: [box.root],
  });
});

// ## A running wakeup holds the check off
//
// With the cycle lock held by a live holder, the check starts nothing and does
// not touch its state file.
void test("A running wakeup holds the check off", async (t) => {
  const box = await committedJobBox(t);
  const lock = wakeupCycleLockPath(box.root);
  await acquireLock(lock, { purpose: "wakeup-cycle" });
  const s = starter("started");
  const held = await checkWaitingJobs(box.root, { start: s.start });
  await releaseLock(lock);
  const stateFile = await readFile(jobCheckStatePath(box.root), "utf-8").catch(() => "no state file");
  t.check({ held, calls: s.calls, stateFile }, { held: { kind: "wakeup-running" }, calls: [], stateFile: "no state file" });
});

// ## Two passes at once start one run
//
// A manual pass beside the daemon's: both see the job, one holds the check's
// lock while its starter waits, and the run is started and counted once.
void test("Two passes at once start one run", async (t) => {
  const box = await committedJobBox(t);
  const answer = Promise.withResolvers<JobCheckStart>();
  let calls = 0;
  const start = (): Promise<JobCheckStart> => {
    calls += 1;
    return answer.promise;
  };
  const both = Promise.all([checkWaitingJobs(box.root, { start }), checkWaitingJobs(box.root, { start })]);
  setTimeout(() => answer.resolve({ state: "started", detail: "" }), 50);
  const results = await both;
  t.check({ results, calls, runsToday: (await readJobCheckState(box.root)).state.runsToday }, {
    results: [{ kind: "started", files: [FILE] }, { kind: "none-due" }],
    calls: 1,
    runsToday: 1,
  });
});

// ## Only a started run is charged
//
// `running` (another cycle took the lock first), `failed`, and a throw (the
// server could not be reached) leave the attempts and today's count alone, and
// each is logged; the next pass tries again.
void test("Only a started run is charged", async (t) => {
  const box = await committedJobBox(t);
  const results = [];
  for (const answer of ["running", "failed", "throws"] as const) {
    results.push(await checkWaitingJobs(box.root, { start: starter(answer).start }));
  }
  const { state } = await readJobCheckState(box.root);
  t.check({ results, attempts: state.jobs[FILE]?.attempts, runsToday: state.runsToday, log: await jobCheckLog(box) }, {
    results: [
      { kind: "not-started", state: "running", detail: "answered running" },
      { kind: "not-started", state: "failed", detail: "answered failed" },
      { kind: "not-started", state: "failed", detail: "The box's server could not be reached" },
    ],
    attempts: 0,
    runsToday: 0,
    log: [
      { action: "not started", state: "running", detail: "answered running", files: [FILE] },
      { action: "not started", state: "failed", detail: "answered failed", files: [FILE] },
      { action: "not started", state: "failed", detail: "The box's server could not be reached", files: [FILE] },
    ],
  });
});

// ## Seven days after first sight the job is given up
//
// The job keeps failing (it stays after each run). At t0+7d the check marks it
// given up and logs that once; later passes start nothing for it, and an edit
// does not revive it. The card stays for the stalled-jobs health check.
void test("Seven days after first sight the job is given up", async (t) => {
  const box = await committedJobBox(t);
  const s = starter("started");
  await checkWaitingJobs(box.root, { start: s.start });
  setTime(later(7 * 24 * HOUR));
  const expired = await checkWaitingJobs(box.root, { start: s.start });
  await appendFile(join(box.root, JOB), "Edited after giving up.\n");
  box.commitAll("edit the job");
  setTime(later(7 * 24 * HOUR + HOUR));
  const edited = await checkWaitingJobs(box.root, { start: s.start });
  t.check({ expired, edited, calls: s.calls, log: await jobCheckLog(box) }, {
    expired: { kind: "none-due" },
    edited: { kind: "none-due" },
    calls: [box.root],
    log: [{ action: "started", files: [FILE], runsToday: 1 }, { action: "gave up", file: FILE }],
  });
});

// ## An unreadable state file stops the check
//
// The file may hide today's count, so the check fails closed: it starts
// nothing, leaves the file as it is, and names it in one line per pass.
void test("An unreadable state file stops the check", async (t) => {
  const box = await committedJobBox(t);
  await box.write(".beebox/job-check.json", "{ not json");
  const s = starter("started");
  const result = await checkWaitingJobs(box.root, { start: s.start });
  t.check({ result, calls: s.calls, file: await readFile(jobCheckStatePath(box.root), "utf-8"), log: await jobCheckLog(box) }, {
    result: { kind: "state-unreadable" },
    calls: [],
    file: "{ not json",
    log: [
      { action: "state unreadable", file: jobCheckStatePath(box.root), error: "Expected property name or '}' in JSON at position 2 (line 1 column 3)" },
    ],
  });
});

// ## The attempt is charged before the run starts
//
// The attempt and today's count are on disk when the starter is called, so a
// write that fails can never let a run go uncounted: if the charge cannot be
// saved, nothing starts. A run that answers `running` is refunded.
void test("The attempt is charged before the run starts", async (t) => {
  const box = await committedJobBox(t);
  const seenAtStart: unknown[] = [];
  const start = async (): Promise<JobCheckStart> => {
    const { state } = await readJobCheckState(box.root);
    seenAtStart.push({ runsToday: state.runsToday, attempts: state.jobs[FILE]?.attempts });
    return { state: "running", detail: "another cycle" };
  };
  const refunded = await checkWaitingJobs(box.root, { start });
  const afterRefund = await readJobCheckState(box.root);

  const s = starter("started");
  const unsaved = await checkWaitingJobs(box.root, {
    start: s.start,
    writeState: () => Promise.reject(new Error("disk full")),
  }).catch((e: unknown) => (e instanceof Error ? `threw: ${e.message}` : "threw"));
  t.check(
    { refunded, seenAtStart, after: [afterRefund.state.runsToday, afterRefund.state.jobs[FILE]?.attempts], unsaved, calls: s.calls },
    {
      refunded: { kind: "not-started", state: "running", detail: "another cycle" },
      seenAtStart: [{ runsToday: 1, attempts: 1 }],
      after: [0, 0],
      unsaved: "threw: disk full",
      calls: [],
    },
  );
});

// ## Connector and low-priority jobs ride along
//
// A committed job tagged with a connector belongs to that connector's scoped
// wakeup; a low-priority one rides along with any full wakeup. Neither starts
// a run.
void test("Connector and low-priority jobs ride along", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  await box.write("_bookkeeping/jobs/mail.intake.job.card", "---\nconnector: gmail\npriority: normal\n---\n");
  await box.write("_bookkeeping/jobs/photos.intake.job.card", "---\npriority: low\n---\n");
  box.commitAll("jobs that ride along");
  const s = starter("started");
  t.check({ result: await checkWaitingJobs(box.root, { start: s.start }), calls: s.calls }, { result: { kind: "idle" }, calls: [] });
});

// ## The daily bound
//
// At 24 runs started today the check starts nothing and logs the bound once
// that day.
void test("The daily bound", async (t) => {
  const box = await committedJobBox(t);
  const today = await boxLocalDay(box.root, new Date(T0));
  await writeFile(jobCheckStatePath(box.root), JSON.stringify({ day: today, runsToday: 24, boundLoggedDay: null, jobs: {} }));
  const s = starter("started");
  const first = await checkWaitingJobs(box.root, { start: s.start });
  const second = await checkWaitingJobs(box.root, { start: s.start });
  t.check({ first, second, calls: s.calls, log: await jobCheckLog(box) }, {
    first: { kind: "daily-bound" },
    second: { kind: "daily-bound" },
    calls: [],
    log: [{ action: "daily bound", runsToday: 24, files: [FILE] }],
  });
});
