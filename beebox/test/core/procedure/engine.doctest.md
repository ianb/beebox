# Procedure Engine

Tests for the procedure engine — parsing definitions, executing steps,
tracking state in run cards, and handling various step outcomes.

```ts setup
import { startProcedure, resumeProcedure } from "../../../src/core/procedure/engine/core.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { getLog } from "../../../src/lib/git/core/operations.js";
import { parseProcedureRun } from "../../../src/schemas/procedure-run.js";

/** A shell list item for a YAML `shells:` block. */
const shells = (script) =>
  `      shells:\n        - |\n${script.split("\n").map((l) => `          ${l}`).join("\n")}\n`;

/**
 * One procedure step as YAML. `run`, `precheck` and `validate` are shell scripts;
 * `severity` goes with `validate`; `agent` is a prompt for an agent run phase.
 */
function step(id, { precheck, run, validate, severity, agent }) {
  return [
    `  - id: ${id}\n    description: Step ${id}\n`,
    precheck === undefined ? "" : `    precheck:\n${shells(precheck)}`,
    agent === undefined ? `    run:\n${shells(run)}` : `    run:\n      agents:\n        - prompt: ${agent}\n`,
    validate === undefined ? "" : `    validate:\n      severity: ${severity}\n${shells(validate)}`,
  ].join("");
}

/** A procedure card; `header` adds extra frontmatter lines (e.g. `run-expiry: never`). */
const procedure = (name, steps, header) =>
  `---\nname: ${name}\n${header ?? ""}description: Procedure ${name}\nsteps:\n${steps.join("")}---\n`;

/** A throwaway git box holding the procedure cards (name -> card text), passed to `fn`. */
async function withBox(cards, fn) {
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
const contextFor = (box) => {
  const lines = [];
  return { lines, ctx: { boxRoot: box.root, writeLine: (l) => lines.push(l), write: () => {} } };
};

/** File names the procedures created under `_bookkeeping/output`. */
const outputsOf = async (box) =>
  (await box.list("_bookkeeping/output")).split("\n").filter((f) => f && !f.endsWith(".gitkeep")).map((f) => f.split("/").pop());

/** The run dir for procedure `name` (null before any run). */
const runDirOf = async (box, name) =>
  (await box.list("_bookkeeping/procedure/runs")).split("\n").find((f) => f.includes(`${name}_`)) ?? null;

/** The parsed run card for procedure `name` (null before any run). */
async function runCardOf(box, name) {
  const dir = await runDirOf(box, name);
  return dir ? parseProcedureRun(await box.read(`${dir}/run.procedure-run.card`)) : null;
}

/**
 * Start procedure `name` from `card` (null: no such card) on a fresh box and report what happened:
 * `ok`/`error`/`status` of the result, output `lines`, the files created under
 * `_bookkeeping/output`, the parsed run card (null if none) and the commit count.
 */
async function startOn(name, card, options) {
  return withBox(card === null ? {} : { [name]: card }, async (box) => {
    const { ctx, lines } = contextFor(box);
    const result = await startProcedure({ ctx, procedureNameOrPath: name, options });
    return {
      ok: result.ok,
      error: result.ok ? undefined : result.error.message,
      status: result.ok ? result.value.status : undefined,
      lines,
      files: await outputsOf(box),
      run: await runCardOf(box, name),
      runsListing: await box.list("_bookkeeping/procedure/runs"),
      commits: (await getLog(box.root)).length,
    };
  });
}

/** Per-step statuses of a run card as "id=status, ..." */
const stepStatuses = (run) => run.steps.map((s) => `${s.id}=${s.status}`).join(", ");
```

## Shell-only procedure: happy path

A procedure with a single shell step runs to completion. The engine
creates a run directory, commits at each phase boundary, and records
results in the run card.

```ts
const r = await startOn("greet", procedure("greet", [
  step("hello", { run: 'echo "Hello from procedure" > _bookkeeping/output/greeting.txt' }),
]));
({ ok: r.ok, files: r.files, outcome: r.run.outcome, steps: stepStatuses(r.run) })
=> { ok: true, files: ["greeting.txt"], outcome: "completed", steps: "hello=completed" }
```

## Precheck skip

When a precheck exits with `$CHECK_SKIP`, the step is skipped — not
failed. The procedure continues to the next step, and the skipped step's
shell never ran. A precheck that printed nothing reports its exit code as a
number, in plain text.

```ts
const r = await startOn("maybe", procedure("maybe", [
  step("skipped", { precheck: "exit $CHECK_SKIP", run: 'echo "SHOULD NOT RUN" > _bookkeeping/output/bad.txt' }),
  step("runs", { run: 'echo "OK" > _bookkeeping/output/good.txt' }),
]));
({ ok: r.ok, skipLine: r.lines.find((l) => l.includes("Skipped:")), files: r.files, steps: stepStatuses(r.run) })
=> { ok: true, skipLine: "  Skipped: precheck exit 75", files: ["good.txt"], steps: "skipped=skipped, runs=completed" }
```

## No-op run leaves nothing behind

When every step skips, the run was a no-op: the run directory is removed
at completion and no commits are made. Provenance for no-op ticks lives in
scheduler.jsonl, not in a dir-per-nothing. Commits are only init plus the
procedure card itself.

```ts
const r = await startOn("idle", procedure("idle", [
  step("first", { precheck: 'echo "nothing new"; exit $CHECK_SKIP', run: 'echo "NEVER" > _bookkeeping/output/never.txt' }),
  step("second", { precheck: "exit $CHECK_SKIP", run: 'echo "ALSO NEVER" > _bookkeeping/output/also.txt' }),
]));
({ ok: r.ok, status: r.status, runsListing: r.runsListing, commits: r.commits })
=> { ok: true, status: "skipped", runsListing: "_bookkeeping/procedure/runs/.gitkeep", commits: 2 }
```

## A failing precheck stops the procedure

When a precheck exits with a non-zero, non-skip code, the step fails
and the procedure halts — later steps don't run, and neither does the failed
step's own run phase. The precheck's stdout is captured on the run card so the
reason is inspectable after the fact.

```ts
const r = await startOn("fail-early", procedure("fail-early", [
  step("broken", { precheck: 'echo "missing prerequisite: config not found"\nexit 1', run: 'echo "NEVER" > _bookkeeping/output/never.txt' }),
  step("after", { run: 'echo "ALSO NEVER" > _bookkeeping/output/also.txt' }),
]));
const first = r.run.steps[0];
({
  ok: r.ok,
  files: r.files,
  stepStatus: first.status,
  precheckStatus: first.precheck.status,
  recordsReason: first.precheck.stdout.includes("missing prerequisite"),
})
=> { ok: false, files: [], stepStatus: "failed", precheckStatus: "fail", recordsReason: true }
```

## Validation with severity

Validation shells run after the step's run phase. `severity="warn"`
lets the procedure continue; `severity="abort"` stops it.

```ts
const warned = await startOn("validate", procedure("validate", [
  step("warned", { run: 'echo "did work" > _bookkeeping/output/work.txt', validate: 'echo "not ideal"; exit 1', severity: "warn" }),
  step("after-warn", { run: 'echo "still going" > _bookkeeping/output/still.txt' }),
]));
const aborted = await startOn("abort", procedure("abort", [
  step("checked", { run: 'echo "ran" > _bookkeeping/output/ran.txt', validate: 'echo "bad output"; exit 1', severity: "abort" }),
  step("never", { run: 'echo "nope" > _bookkeeping/output/nope.txt' }),
]));
({
  warn: { ok: warned.ok, files: warned.files, validateStatus: warned.run.steps.find((s) => s.id === "warned").validate.status },
  abort: { ok: aborted.ok, files: aborted.files },
})
=> {
  warn: { ok: true, files: ["still.txt", "work.txt"], validateStatus: "warn" },
  abort: { ok: false, files: ["ran.txt"] }
}
```

## A failing run shell fails the step

A non-zero exit from a run-phase shell fails the step (it does not silently
"complete") and halts the procedure. The failure detail — exit code plus both
output streams — is recorded on the step's run record so `bbx procedure status`
shows why.

```ts
const r = await startOn("runfail", procedure("runfail", [
  step("work", { run: 'echo "doing work"\necho "boom" >&2\nexit 3' }),
  step("after", { run: 'echo "nope" > _bookkeeping/output/nope.txt' }),
]));
const detail = r.run.steps[0].run.stdout;
({
  ok: r.ok,
  error: r.error,
  files: r.files,
  stepStatus: r.run.steps[0].status,
  outcome: r.run.outcome,
  recordsExitCode: detail.includes("exit 3"),
  recordsStderr: detail.includes("boom"),
})
=> {
  ok: false,
  error: "Procedure runfail failed at step: work",
  files: [],
  stepStatus: "failed",
  outcome: "failed",
  recordsExitCode: true,
  recordsStderr: true
}
```

## Strict shell mode

Shells run under `set -euo pipefail`. `-u` turns a reference to an unset
variable (often a typo'd name) into a hard error instead of a silent empty
expansion — surfaced as a clear `unbound variable` message.

`pipefail` makes a pipeline fail when any stage fails, not just the last —
so `false | cat` fails the step instead of masking the error behind `cat`'s
success. Combined with `-e`, the script stops at the failing pipe, so the
later command never ran.

```ts
const nounset = await startOn("nounset", procedure("nounset", [
  step("typo", { run: 'echo "count is $COUNNT"' }),
]));
const pipe = await startOn("pipe", procedure("pipe", [
  step("piped", { run: 'false | cat\necho "reached" > _bookkeeping/output/reached.txt' }),
]));
({
  nounset: {
    ok: nounset.ok,
    stepStatus: nounset.run.steps[0].status,
    mentionsUnbound: nounset.run.steps[0].run.stdout.toLowerCase().includes("unbound variable"),
  },
  pipefail: { ok: pipe.ok, files: pipe.files, stepStatus: pipe.run.steps[0].status },
})
=> {
  nounset: { ok: false, stepStatus: "failed", mentionsUnbound: true },
  pipefail: { ok: false, files: [], stepStatus: "failed" }
}
```

## Dry run previews without executing

```ts
const r = await startOn("preview", procedure("preview", [
  step("first", { precheck: "true", run: 'echo "side effect" > _bookkeeping/output/effect.txt', validate: "true", severity: "warn" }),
  step("second", { agent: "Do something" }),
]), { dryRun: true });
// No side effects, and the output describes both steps
({
  ok: r.ok,
  files: r.files,
  mentionsSteps: ["first", "second"].map((id) => r.lines.some((l) => l.includes(id))),
})
=> { ok: true, files: [], mentionsSteps: [true, true] }
```

## Step filtering with --step

```ts
const r = await startOn("multi", procedure("multi", [
  step("alpha", { run: 'echo "a" > _bookkeeping/output/a.txt' }),
  step("beta", { run: 'echo "b" > _bookkeeping/output/b.txt' }),
]), { step: "beta" });
({ ok: r.ok, files: r.files })
=> { ok: true, files: ["b.txt"] }
```

## Missing procedure and invalid --step return errors

A name with no procedure card is an error mentioning "not found"; a `--step`
that is not in the procedure is an error listing the available step ids.

```ts
const missing = await startOn("nonexistent", null);
const badStep = await startOn("steps", procedure("steps", [step("real", { run: "true" })]), { step: "fake" });
({
  missing: [missing.ok, missing.error.includes("not found")],
  badStep: [badStep.ok, badStep.error.includes("real")],
})
=> { missing: [false, true], badStep: [false, true] }
```

## Finished runs carry an expires stamp

At completion the engine stamps `expires` on the run card — completed-at
plus 30 days for completed runs, 90 days for failed runs. `bbx procedure gc`
deletes run dirs past their stamp; anyone can edit the attribute to pin or
extend a specific run. `run-expiry` / `failed-run-expiry` attributes on the
procedure definition override the defaults; "never" pins every run of that
procedure.

```ts
const dayMs = 24 * 60 * 60 * 1000;
const expiry = async (name, card) => {
  const { ok, run } = await startOn(name, card);
  const days = run.expires === "never" ? "never" : `${Math.round((Date.parse(run.expires) - Date.parse(run["completed-at"])) / dayMs)}d`;
  return `${ok ? "ok" : "failed"} ${run.outcome}, expires: ${days}`;
};
({
  completed: await expiry("stamped", procedure("stamped", [step("work", { run: 'echo "did it" > _bookkeeping/output/did.txt' })])),
  failed: await expiry("doomed", procedure("doomed", [step("broken", { precheck: "exit 1", run: "true" })])),
  pinned: await expiry("keeper", procedure("keeper", [step("work", { run: 'echo "kept" > _bookkeeping/output/kept.txt' })], "run-expiry: never\n")),
})
=> { completed: "ok completed, expires: 30d", failed: "failed failed, expires: 90d", pinned: "ok completed, expires: never" }
```

## Resume re-runs from the failed step, not the whole procedure

When a run fails partway, `resumeProcedure` re-runs from the first
not-yet-completed step in the same run dir/card. Earlier completed steps
are not re-run; later pending steps execute for the first time.

Here `beta`'s precheck is gated on a sentinel file. The first run fails at
`beta` (`alpha` already completed, `gamma` never reached). After the
sentinel is created, resuming completes the run — and `alpha`, which
appends a marker each time it runs, is left untouched.

```ts
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
    return { outcome: run.outcome, steps: stepStatuses(run), files: (await outputsOf(box)).filter((f) => f !== "sentinel").toSorted(), alphaRuns: await alphaRuns() };
  };

  // First run: halts at beta (sentinel missing).
  const first = await startProcedure({ ctx, procedureNameOrPath: "staged" });
  const afterFirst = { ok: first.ok, ...(await snapshot()) };

  // Fix the gating condition and resume.
  await box.write("_bookkeeping/output/sentinel", "");
  box.commitAll("Add sentinel");
  const resumed = await resumeProcedure({ ctx, runDir: await runDirOf(box, "staged") });
  return { afterFirst, afterResume: { ok: resumed.ok, ...(await snapshot()) } };
});
states
=> {
  afterFirst: { ok: false, outcome: "failed", steps: "alpha=completed, beta=failed, gamma=pending", files: ["alpha-runs.txt"], alphaRuns: "x" },
  afterResume: { ok: true, outcome: "completed", steps: "alpha=completed, beta=completed, gamma=completed", files: ["alpha-runs.txt", "b.txt", "c.txt"], alphaRuns: "x" }
}
```

## Resuming a completed run is a no-op

Resuming an already-completed run changes nothing and reports success.

```ts
const noop = await withBox({ done: procedure("done", [step("only", { run: 'echo "done" > _bookkeeping/output/done.txt' })]) }, async (box) => {
  const { ctx } = contextFor(box);
  await startProcedure({ ctx, procedureNameOrPath: "done" });
  const result = await resumeProcedure({ ctx, runDir: await runDirOf(box, "done") });
  return { ok: result.ok, outcome: (await runCardOf(box, "done")).outcome };
});
noop
=> { ok: true, outcome: "completed" }
```

## Resuming an inconclusive run reports the non-verdict, not "completed"

Every step's work finished, so there is nothing to resume — but the run was
never judged, and resume has no re-judging path. Reporting "completed / nothing
to resume" would answer a question about the review with the state of the work.
Instead it re-reports the standing non-verdict, read back out of the run card,
which the CLI turns into the same stderr line and exit code `bbx procedure run`
printed. The run card is left alone: an `inconclusive` run is never re-opened,
so resume does not remove its outcome.

```ts
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
({
  ok: result.ok,
  status: result.value.status,
  inconclusive: result.value.inconclusive,
  outcomeAfter: parseProcedureRun(await box.read(`${dir}/run.procedure-run.card`)).outcome,
})
=> {
  ok: true,
  status: "inconclusive",
  inconclusive: [{ stepId: "maps", reason: "max-turns", detail: "reached max turns (16)" }],
  outcomeAfter: "inconclusive"
}
```

```ts cleanup
await box.cleanup();
```

## Resume with no runs returns an error

```ts
const none = await withBox({}, async (box) => {
  const { ctx } = contextFor(box);
  const result = await resumeProcedure({ ctx });
  return { ok: result.ok, error: result.ok ? "" : result.error.message };
});
none
=> { ok: false, error: "No procedure run found to resume." }
```
