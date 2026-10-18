// # Procedure Engine
//
// Tests for the procedure engine — parsing definitions, executing steps,
// tracking state in run cards, and handling various step outcomes.

import { test } from "tap";
import "agent-doctest/tap";
import assert from "node:assert/strict";
import { startProcedure, resumeProcedure } from "../../../src/core/procedure/engine/core.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { getLog } from "../../../src/lib/git/core/operations.js";
import { parseProcedureRun } from "../../../src/schemas/procedure-run.js";
import type { ProcedureRun } from "../../../src/schemas/procedure-run.js";
import type { Result } from "../../../src/shared/result.js";
import type { TmpBox } from "../../helpers/test-helpers.js";
import type { ProcedureOptions } from "../../../src/core/procedure/engine-types.js";

/** A shell list item for a YAML `shells:` block. */
const shells = (script: string) =>
  `      shells:\n        - |\n${script.split("\n").map((l: string) => `          ${l}`).join("\n")}\n`;

/**
 * One procedure step as YAML. `run`, `precheck` and `validate` are shell scripts;
 * `severity` goes with `validate`; `agent` is a prompt for an agent run phase.
 */
function step(id: string, { precheck, run, validate, severity, agent }: { precheck?: string; run?: string; validate?: string; severity?: string; agent?: string }) {
  return [
    `  - id: ${id}\n    description: Step ${id}\n`,
    precheck === undefined ? "" : `    precheck:\n${shells(precheck)}`,
    agent === undefined ? `    run:\n${shells(run ?? "")}` : `    run:\n      agents:\n        - prompt: ${agent}\n`,
    validate === undefined ? "" : `    validate:\n      severity: ${severity}\n${shells(validate)}`,
  ].join("");
}

/** A procedure card. */
const procedure = (name: string, steps: string[]) =>
  `---\nname: ${name}\ndescription: Procedure ${name}\nsteps:\n${steps.join("")}---\n`;

/** A throwaway git box holding the procedure cards (name -> card text), passed to `fn`. */
async function withBox<T>(cards: Record<string, string>, fn: (box: TmpBox) => Promise<T>): Promise<T> {
  const box = await makeTmpBox({ git: true });
  try {
    for (const [name, text] of Object.entries(cards)) await box.write(`_config/procedures/${name}.procedure.card`, text);
    await box.write("_bookkeeping/output/.gitkeep", "");
    box.commitAll("Add procedures");
    return await fn(box);
  } finally {
    await box.cleanup();
  }
}

/** A procedure context whose output lines are collected in `lines`. */
const contextFor = (box: TmpBox) => {
  const lines: string[] = [];
  return { lines, ctx: { boxRoot: box.root, writeLine: (l: string) => { lines.push(l); }, write: () => {} } };
};

/** File names the procedures created under `_bookkeeping/output`. */
const outputsOf = async (box: TmpBox) =>
  (await box.list("_bookkeeping/output")).split("\n").filter((f) => f && !f.endsWith(".gitkeep")).map((f) => f.split("/").pop());

/** The run dir for procedure `name` (null before any run). */
const runDirOf = async (box: TmpBox, name: string) =>
  (await box.list("_bookkeeping/procedure/runs")).split("\n").find((f) => f.includes(`${name}_`)) ?? null;

/** The run dir for procedure `name`; fails the test when there is none. */
const requireRunDir = async (box: TmpBox, name: string): Promise<string> => {
  const dir = await runDirOf(box, name);
  assert.ok(dir !== null);
  return dir;
};

/** The value of a successful result; fails the test on an error. */
function valueOf<T, E>(result: Result<T, E>): T {
  assert.ok(result.ok);
  return result.value;
}

/** The parsed run card for procedure `name` (null before any run). */
async function runCardOf(box: TmpBox, name: string) {
  const dir = await runDirOf(box, name);
  return dir ? parseProcedureRun(await box.read(`${dir}/run.procedure-run.card`)) : null;
}

/**
 * Start procedure `name` from `card` (null: no such card) on a fresh box and report what happened:
 * `ok`/`error`/`status` of the result, output `lines`, the files created under
 * `_bookkeeping/output`, the parsed run card (null if none) and the commit count.
 */
async function startOn(name: string, card: string | null) {
  return startOnWith({ name, card });
}

/** `startOn` with the start options, for the cases that pass some. */
async function startOnWith(spec: { name: string; card: string | null; options?: ProcedureOptions }) {
  const { name, card, options } = spec;
  return withBox(card === null ? {} : { [name]: card }, async (box) => {
    const { ctx, lines } = contextFor(box);
    const result = await startProcedure({ ctx, procedureNameOrPath: name, options: options ?? {} });
    return {
      ok: result.ok,
      error: result.ok ? undefined : result.error.message,
      status: result.ok ? valueOf(result).status : undefined,
      lines,
      files: await outputsOf(box),
      run: await runCardOf(box, name),
      runsListing: await box.list("_bookkeeping/procedure/runs"),
      commits: (await getLog(box.root)).length,
    };
  });
}

/** Per-step statuses of a run card as "id=status, ..." */
const stepStatuses = (run: ProcedureRun | null) => (run?.steps ?? []).map((s) => `${s.id}=${s.status}`).join(", ");

// ## Shell-only procedure: happy path
//
// A procedure with a single shell step runs to completion. The engine
// creates a run directory, commits at each phase boundary, and records
// results in the run card.
void test("A procedure with a single shell step runs to completion.", async (t) => {
  // doctest:L117
  const r = await startOn("greet", procedure("greet", [
    step("hello", { run: 'echo "Hello from procedure" > _bookkeeping/output/greeting.txt' }),
  ]));
  t.check(({ ok: r.ok, files: r.files, outcome: r.run?.outcome, steps: stepStatuses(r.run) }), {
    ok: true,
    files: [
      "greeting.txt",
    ],
    outcome: "completed",
    steps: "hello=completed",
  });
});

// ## Precheck skip
//
// When a precheck exits with `$CHECK_SKIP`, the step is skipped — not
// failed. The procedure continues to the next step, and the skipped step's
// shell never ran. A precheck that printed nothing reports its exit code as a
// number, in plain text.
void test("When a precheck exits with $CHECKSKIP, the step is skipped — not failed.", async (t) => {
  // doctest:L132
  const r = await startOn("maybe", procedure("maybe", [
    step("skipped", { precheck: "exit $CHECK_SKIP", run: 'echo "SHOULD NOT RUN" > _bookkeeping/output/bad.txt' }),
    step("runs", { run: 'echo "OK" > _bookkeeping/output/good.txt' }),
  ]));
  t.check(({ ok: r.ok, skipLine: r.lines.find((l) => l.includes("Skipped:")), files: r.files, steps: stepStatuses(r.run) }), {
    ok: true,
    skipLine: "  Skipped: precheck exit 75",
    files: [
      "good.txt",
    ],
    steps: "skipped=skipped, runs=completed",
  });
});

// ## No-op run leaves nothing behind
//
// When every step skips, the run was a no-op: the run directory is removed
// at completion and no commits are made. Provenance for no-op ticks lives in
// scheduler.jsonl, not in a dir-per-nothing. Commits are only init plus the
// procedure card itself.
void test("When every step skips, the run was a no-op:", async (t) => {
  // doctest:L148
  const r = await startOn("idle", procedure("idle", [
    step("first", { precheck: 'echo "nothing new"; exit $CHECK_SKIP', run: 'echo "NEVER" > _bookkeeping/output/never.txt' }),
    step("second", { precheck: "exit $CHECK_SKIP", run: 'echo "ALSO NEVER" > _bookkeeping/output/also.txt' }),
  ]));
  t.check(({ ok: r.ok, status: r.status, runsListing: r.runsListing, commits: r.commits }), {
    ok: true,
    status: "skipped",
    runsListing: "_bookkeeping/procedure/runs/.gitkeep",
    commits: 2,
  });
});

// ## A failing precheck stops the procedure
//
// When a precheck exits with a non-zero, non-skip code, the step fails
// and the procedure halts — later steps don't run, and neither does the failed
// step's own run phase. The precheck's stdout is captured on the run card so the
// reason is inspectable after the fact.
void test("When a precheck exits with a non-zero, non-skip code, the step fails and the...", async (t) => {
  // doctest:L164
  const r = await startOn("fail-early", procedure("fail-early", [
    step("broken", { precheck: 'echo "missing prerequisite: config not found"\nexit 1', run: 'echo "NEVER" > _bookkeeping/output/never.txt' }),
    step("after", { run: 'echo "ALSO NEVER" > _bookkeeping/output/also.txt' }),
  ]));
  const first = r.run?.steps[0];
  t.check(
    ({
      ok: r.ok,
      files: r.files,
      stepStatus: first?.status,
      precheckStatus: first?.precheck?.status,
      recordsReason: first?.precheck?.stdout?.includes("missing prerequisite"),
    }),
    {
    ok: false,
    files: [],
    stepStatus: "failed",
    precheckStatus: "fail",
    recordsReason: true,
  },
  );
});

// ## Validation with severity
//
// Validation shells run after the step's run phase. `severity="warn"`
// lets the procedure continue; `severity="abort"` stops it.
void test("Validation shells run after the step's run phase.", async (t) => {
  // doctest:L185
  const warned = await startOn("validate", procedure("validate", [
    step("warned", { run: 'echo "did work" > _bookkeeping/output/work.txt', validate: 'echo "not ideal"; exit 1', severity: "warn" }),
    step("after-warn", { run: 'echo "still going" > _bookkeeping/output/still.txt' }),
  ]));
  const aborted = await startOn("abort", procedure("abort", [
    step("checked", { run: 'echo "ran" > _bookkeeping/output/ran.txt', validate: 'echo "bad output"; exit 1', severity: "abort" }),
    step("never", { run: 'echo "nope" > _bookkeeping/output/nope.txt' }),
  ]));
  t.check(
    ({
      warn: { ok: warned.ok, files: warned.files, validateStatus: warned.run?.steps.find((s) => s.id === "warned")?.validate?.status },
      abort: { ok: aborted.ok, files: aborted.files },
    }),
    {
    warn: {
      ok: true,
      files: [
        "still.txt",
        "work.txt",
      ],
      validateStatus: "warn",
    },
    abort: {
      ok: false,
      files: [
        "ran.txt",
      ],
    },
  },
  );
});

// ## A failing run shell fails the step
//
// A non-zero exit from a run-phase shell fails the step (it does not silently
// "complete") and halts the procedure. The failure detail — exit code plus both
// output streams — is recorded on the step's run record so `bbx procedure status`
// shows why.
void test("A non-zero exit from a run-phase shell fails the step (it does not silently \"...", async (t) => {
  // doctest:L211
  const r = await startOn("runfail", procedure("runfail", [
    step("work", { run: 'echo "doing work"\necho "boom" >&2\nexit 3' }),
    step("after", { run: 'echo "nope" > _bookkeeping/output/nope.txt' }),
  ]));
  const detail = r.run?.steps[0]?.run?.stdout;
  t.check(
    ({
      ok: r.ok,
      error: r.error,
      files: r.files,
      stepStatus: r.run?.steps[0]?.status,
      outcome: r.run?.outcome,
      recordsExitCode: detail?.includes("exit 3"),
      recordsStderr: detail?.includes("boom"),
    }),
    {
    ok: false,
    error: "Procedure runfail failed at step: work",
    files: [],
    stepStatus: "failed",
    outcome: "failed",
    recordsExitCode: true,
    recordsStderr: true,
  },
  );
});

// ## Strict shell mode
//
// Shells run under `set -euo pipefail`. `-u` turns a reference to an unset
// variable (often a typo'd name) into a hard error instead of a silent empty
// expansion — surfaced as a clear `unbound variable` message.
//
// `pipefail` makes a pipeline fail when any stage fails, not just the last —
// so `false | cat` fails the step instead of masking the error behind `cat`'s
// success. Combined with `-e`, the script stops at the failing pipe, so the
// later command never ran.
void test("Shells run under set -euo pipefail.", async (t) => {
  // doctest:L248
  const nounset = await startOn("nounset", procedure("nounset", [
    step("typo", { run: 'echo "count is $COUNNT"' }),
  ]));
  const pipe = await startOn("pipe", procedure("pipe", [
    step("piped", { run: 'false | cat\necho "reached" > _bookkeeping/output/reached.txt' }),
  ]));
  t.check(
    ({
      nounset: {
        ok: nounset.ok,
        stepStatus: nounset.run?.steps[0]?.status,
        mentionsUnbound: nounset.run?.steps[0]?.run?.stdout?.toLowerCase().includes("unbound variable"),
      },
      pipefail: { ok: pipe.ok, files: pipe.files, stepStatus: pipe.run?.steps[0]?.status },
    }),
    {
    nounset: {
      ok: false,
      stepStatus: "failed",
      mentionsUnbound: true,
    },
    pipefail: {
      ok: false,
      files: [],
      stepStatus: "failed",
    },
  },
  );
});

// ## Dry run previews without executing
void test("Dry run previews without executing", async (t) => {
  // doctest:L271
  const r = await startOnWith({ name: "preview", card: procedure("preview", [
    step("first", { precheck: "true", run: 'echo "side effect" > _bookkeeping/output/effect.txt', validate: "true", severity: "warn" }),
    step("second", { agent: "Do something" }),
  ]), options: { dryRun: true } });
  t.check(
    // No side effects, and the output describes both steps
    ({
      ok: r.ok,
      files: r.files,
      mentionsSteps: ["first", "second"].map((id) => r.lines.some((l) => l.includes(id))),
    }),
    {
    ok: true,
    files: [],
    mentionsSteps: [
      true,
      true,
    ],
  },
  );
});

// ## Step filtering with --step
void test("Step filtering with --step", async (t) => {
  // doctest:L287
  const r = await startOnWith({ name: "multi", card: procedure("multi", [
    step("alpha", { run: 'echo "a" > _bookkeeping/output/a.txt' }),
    step("beta", { run: 'echo "b" > _bookkeeping/output/b.txt' }),
  ]), options: { step: "beta" } });
  t.check(({ ok: r.ok, files: r.files }), {
    ok: true,
    files: [
      "b.txt",
    ],
  });
});

// ## Missing procedure and invalid --step return errors
//
// A name with no procedure card is an error mentioning "not found"; a `--step`
// that is not in the procedure is an error listing the available step ids.
void test("A name with no procedure card is an error mentioning \"not found\"; a --step th...", async (t) => {
  // doctest:L301
  const missing = await startOn("nonexistent", null);
  const badStep = await startOnWith({ name: "steps", card: procedure("steps", [step("real", { run: "true" })]), options: { step: "fake" } });
  t.check(
    ({
      missing: [missing.ok, missing.error?.includes("not found")],
      badStep: [badStep.ok, badStep.error?.includes("real")],
    }),
    {
    missing: [
      false,
      true,
    ],
    badStep: [
      false,
      true,
    ],
  },
  );
});

// ## Finished runs carry an expires stamp
//
// At completion the engine stamps `expires` on the run card — completed-at
// plus 30 days for completed runs, 90 days for failed runs. `bbx procedure gc`
// deletes run dirs past their stamp; anyone can edit the attribute to pin or
// extend a specific run. `run-expiry` / `failed-run-expiry` attributes on the
// procedure definition override the defaults; "never" pins every run of that
// procedure.
void test("At completion the engine stamps expires on the run card — completed-at plus 3...", async (t) => {
  // doctest:L320
  const dayMs = 24 * 60 * 60 * 1000;
  const expiry = async (name: string, card: string) => {
    const { ok, run } = await startOn(name, card);
    assert.ok(run?.expires !== undefined && run["completed-at"] !== undefined);
    const days = run.expires === "never" ? "never" : `${Math.round((Date.parse(run.expires) - Date.parse(run["completed-at"])) / dayMs)}d`;
    return `${ok ? "ok" : "failed"} ${run.outcome}, expires: ${days}`;
  };
  t.check(
    ({
      completed: await expiry("stamped", procedure("stamped", [step("work", { run: 'echo "did it" > _bookkeeping/output/did.txt' })])),
      failed: await expiry("doomed", procedure("doomed", [step("broken", { precheck: "exit 1", run: "true" })])),
      pinned: await expiry("keeper", `---\nname: keeper\nrun-expiry: never\ndescription: Procedure keeper\nsteps:\n${step("work", { run: 'echo "kept" > _bookkeeping/output/kept.txt' })}---\n`),
    }),
    {
    completed: "ok completed, expires: 30d",
    failed: "failed failed, expires: 90d",
    pinned: "ok completed, expires: never",
  },
  );
});

// ## Resume re-runs from the failed step, not the whole procedure
//
// When a run fails partway, `resumeProcedure` re-runs from the first
// not-yet-completed step in the same run dir/card. Earlier completed steps
// are not re-run; later pending steps execute for the first time.
//
// Here `beta`'s precheck is gated on a sentinel file. The first run fails at
// `beta` (`alpha` already completed, `gamma` never reached). After the
// sentinel is created, resuming completes the run — and `alpha`, which
// appends a marker each time it runs, is left untouched.
void test("When a run fails partway, resumeProcedure re-runs from the first not-yet-comp...", async (t) => {
  // doctest:L347
  const staged = procedure("staged", [
    step("alpha", { run: 'echo "x" >> _bookkeeping/output/alpha-runs.txt' }),
    step("beta", { precheck: "test -f _bookkeeping/output/sentinel", run: 'echo "b" > _bookkeeping/output/b.txt' }),
    step("gamma", { run: 'echo "c" > _bookkeeping/output/c.txt' }),
  ]);
  const states = await withBox({ staged }, async (box) => {
    const { ctx } = contextFor(box);
    const alphaRuns = async () => (await box.read("_bookkeeping/output/alpha-runs.txt")).trim();
    const snapshot = async () => {
      const run = await runCardOf(box, "staged");
      return { outcome: run?.outcome, steps: stepStatuses(run), files: (await outputsOf(box)).filter((f) => f !== "sentinel").toSorted(), alphaRuns: await alphaRuns() };
    };

    // First run: halts at beta (sentinel missing).
    const first = await startProcedure({ ctx, procedureNameOrPath: "staged" });
    const afterFirst = { ok: first.ok, ...(await snapshot()) };

  // Fix the gating condition and resume.
    await box.write("_bookkeeping/output/sentinel", "");
    box.commitAll("Add sentinel");
    const resumed = await resumeProcedure({ ctx, runDir: await requireRunDir(box, "staged") });
    return { afterFirst, afterResume: { ok: resumed.ok, ...(await snapshot()) } };
  });
  // doctest:L360
  // doctest:L364
  t.check(states, {
    afterFirst: {
      ok: false,
      outcome: "failed",
      steps: "alpha=completed, beta=failed, gamma=pending",
      files: [
        "alpha-runs.txt",
      ],
      alphaRuns: "x",
    },
    afterResume: {
      ok: true,
      outcome: "completed",
      steps: "alpha=completed, beta=completed, gamma=completed",
      files: [
        "alpha-runs.txt",
        "b.txt",
        "c.txt",
      ],
      alphaRuns: "x",
    },
  });
});

// ## Resuming a completed run is a no-op
//
// Resuming an already-completed run changes nothing and reports success.
void test("Resuming an already-completed run changes nothing and reports success.", async (t) => {
  // doctest:L382
  const noop = await withBox({ done: procedure("done", [step("only", { run: 'echo "done" > _bookkeeping/output/done.txt' })]) }, async (box) => {
    const { ctx } = contextFor(box);
    await startProcedure({ ctx, procedureNameOrPath: "done" });
    const result = await resumeProcedure({ ctx, runDir: await requireRunDir(box, "done") });
    return { ok: result.ok, outcome: (await runCardOf(box, "done"))?.outcome };
  });
  t.check(noop, {
    ok: true,
    outcome: "completed",
  });
});

// ## Resuming an inconclusive run reports the non-verdict, not "completed"
//
// Every step's work finished, so there is nothing to resume — but the run was
// never judged, and resume has no re-judging path. Reporting "completed / nothing
// to resume" would answer a question about the review with the state of the work.
// Instead it re-reports the standing non-verdict, read back out of the run card,
// which the CLI turns into the same stderr line and exit code `bbx procedure run`
// printed. The run card is left alone: an `inconclusive` run is never re-opened,
// so resume does not remove its outcome.
void test("Every step's work finished, so there is nothing to resume — but the run was n...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L403
  const box = await makeTmpBox({ git: true });
  const dir = "_bookkeeping/procedure/runs/refresh-maps_2026-08-24T05-00-00";
  await box.write(`${dir}/run.procedure-run.card`, `---
procedure: _config/procedures/refresh-maps.procedure.card
outcome: inconclusive
started-at: 2026-08-24T05:00:00Z
completed-at: 2026-08-24T05:04:00Z
steps:
  - id: maps
    status: completed
    validate:
      status: inconclusive
      error: Review reached max turns (16) — the work was not judged.
      reason: max-turns
---
`);
  box.commitAll("An unjudged run");

  const { ctx } = contextFor(box);
  const result = await resumeProcedure({ ctx, runDir: dir });
  // doctest:L421
  t.check(
    ({
      ok: result.ok,
      status: valueOf(result).status,
      inconclusive: valueOf(result).inconclusive,
      outcomeAfter: parseProcedureRun(await box.read(`${dir}/run.procedure-run.card`))?.outcome,
    }),
    {
    ok: true,
    status: "inconclusive",
    inconclusive: [
      {
        stepId: "maps",
        reason: "max-turns",
        detail: "reached max turns (16)",
      },
    ],
    outcomeAfter: "inconclusive",
  },
  );
});

// ## Resume with no runs returns an error
void test("Resume with no runs returns an error", async (t) => {
  // doctest:L444
  const none = await withBox({}, async (box) => {
    const { ctx } = contextFor(box);
    const result = await resumeProcedure({ ctx });
    return { ok: result.ok, error: result.ok ? "" : result.error.message };
  });
  t.check(none, {
    ok: false,
    error: "No procedure run found to resume.",
  });
});
