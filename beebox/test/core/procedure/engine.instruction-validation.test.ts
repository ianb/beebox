// # Procedure Engine: Instruction Validation (end-to-end)
//
// `instructions:` in a `validate` phase are now evaluated by a review model against
// the step's git diff, gated by `severity`. These tests drive a full
// `startProcedure` with a fake agent that both does the run-phase work and returns
// the scripted verdict for the validate-phase judge.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate } from "@ianbicking/tap-check/check";
import assert from "node:assert/strict";
import type { AgentFactory } from "../../../src/core/procedure/engine-types.js";
import type { Result } from "../../../src/shared/result.js";
import { startProcedure } from "../../../src/core/procedure/engine/core.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { createFakeAgent } from "../fake-agent.js";
import { parseProcedureRun } from "../../../src/schemas/procedure-run.js";
import { procedureOutcome } from "../../../src/core/commands/procedure.js";
import { formatInconclusiveLine } from "../../../src/shared/inconclusive.js";

// The clock stamps, session id and git refs in a run card are minted per run.
const stamps = { "started-at": isoDate(), "completed-at": isoDate() };
const sessionId = any(String).startsWith("fake-");
const gitRef = any(String).matches(/^[\da-f]{40}$/);

/** The value of a successful result; fails the test on an error. */
function valueOf<T, E>(result: Result<T, E>): T {
  assert.ok(result.ok);
  return result.value;
}

// ## Passing instruction + the judge sees the whole multi-commit diff
//
// The run agent makes **two** commits; the instruction judge must receive the
// full `baseline..finalRef` range (both commits), not just the last one. The
// verdict passes, so the step completes and the `review` reasoning is recorded.
void test("The run agent makes two commits; the instruction judge must receive the full...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await box.write("_config/procedures/instr.procedure.card", `---
name: instr
description: Instruction validation
steps:
  - id: work
    description: Agent does work across two commits
    run:
      agents:
        - prompt: Do the work.
    validate:
      severity: abort
      instructions:
        - Both output files must exist.
---
`);
  await box.write("_bookkeeping/output/.gitkeep", "");
  box.commitAll("Add instr procedure");

  let judgePrompt = "";
  const createAgent: AgentFactory = (opts) => createFakeAgent({
    name: opts.name,
    act: async () => {
      await box.write("_bookkeeping/output/a.txt", "FIRST-CHANGE");
      box.commitAll("agent commit 1");
      await box.write("_bookkeeping/output/b.txt", "SECOND-CHANGE");
      box.commitAll("agent commit 2");
      return { success: true };
    },
    structuredResult: ({ systemPrompt }) => {
      judgePrompt = systemPrompt ?? "";
      return { passed: true, reasoning: "Both files are present in the diff." };
    },
  });

  const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
  const result = await startProcedure({
    ctx,
    procedureNameOrPath: "instr",
    options: { createAgent },
  });
  // The judge's diff (a large generated prompt) spans BOTH agent commits, not just the last.
  t.check(judgePrompt, any(String).includes("FIRST-CHANGE"));
  t.check(judgePrompt, any(String).includes("SECOND-CHANGE"));

  const runs = await box.list("_bookkeeping/procedure/runs");
  const runDir = runs.split("\n").find(f => f.includes("instr_"));
  const run = parseProcedureRun(await box.read(runDir + "/run.procedure-run.card"));
  t.check({ result, step: run?.steps[0] }, {
    result: { ok: true, value: { status: "completed", procedure: "instr", inconclusive: [] } },
    step: {
      id: "work",
      status: "completed",
      ...stamps,
      run: { "session-id": sessionId, "git-ref": gitRef },
      validate: { status: "pass", review: "Both files are present in the diff." },
    },
  });
});

// ## Failing instruction under `abort` fails the step and halts
void test("Failing instruction under `abort` fails the step and halts", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await box.write("_config/procedures/gate.procedure.card", `---
name: gate
description: Instruction gates
steps:
  - id: checked
    description: Validation aborts on a failing instruction
    run:
      agents:
        - prompt: Do work.
    validate:
      severity: abort
      instructions:
        - The work must be complete.
  - id: never
    description: Should not run
    run:
      shells:
        - |
          echo "nope" > _bookkeeping/output/nope.txt
---
`);
  await box.write("_bookkeeping/output/.gitkeep", "");
  box.commitAll("Add gate procedure");

  const createAgent: AgentFactory = (opts) => createFakeAgent({
    name: opts.name,
    act: async () => {
      await box.write("_bookkeeping/output/partial.txt", "half done");
      box.commitAll("agent partial work");
      return { success: true };
    },
    structuredResult: () => ({ passed: false, reasoning: "Work is incomplete." }),
  });

  const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
  const result = await startProcedure({
    ctx,
    procedureNameOrPath: "gate",
    options: { createAgent },
  });
  const files = await box.list("_bookkeeping/output");

  const runs = await box.list("_bookkeeping/procedure/runs");
  const runDir = runs.split("\n").find(f => f.includes("gate_"));
  const run = parseProcedureRun(await box.read(runDir + "/run.procedure-run.card"));
  // The second step ("never") did not run, so it left no nope.txt.
  t.check({ result, files, steps: run?.steps }, {
    result: { ok: false, error: { cause: "step-failed", message: "Procedure gate failed at step: checked" } },
    files: `_bookkeeping/output/.gitkeep
_bookkeeping/output/partial.txt`,
    steps: [
      {
        id: "checked",
        status: "failed",
        ...stamps,
        run: { "session-id": sessionId, "git-ref": gitRef },
        validate: { status: "fail", review: "Work is incomplete." },
      },
      { id: "never", status: "pending" },
    ],
  });
});

// ## Failing instruction under `warn` continues
void test("Failing instruction under `warn` continues", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await box.write("_config/procedures/soft.procedure.card", `---
name: soft
description: Instruction warns
steps:
  - id: lax
    description: Validation warns on a failing instruction
    run:
      agents:
        - prompt: Do work.
    validate:
      severity: warn
      instructions:
        - Ideally everything is tidy.
  - id: after
    description: Runs after the warning
    run:
      shells:
        - |
          echo "ok" > _bookkeeping/output/after.txt
---
`);
  await box.write("_bookkeeping/output/.gitkeep", "");
  box.commitAll("Add soft procedure");

  const createAgent: AgentFactory = (opts) => createFakeAgent({
    name: opts.name,
    act: async () => {
      await box.write("_bookkeeping/output/messy.txt", "eh");
      box.commitAll("agent work");
      return { success: true };
    },
    structuredResult: () => ({ passed: false, reasoning: "Not tidy, but non-blocking." }),
  });

  const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
  const result = await startProcedure({
    ctx,
    procedureNameOrPath: "soft",
    options: { createAgent },
  });
  const files = await box.list("_bookkeeping/output");

  const runs = await box.list("_bookkeeping/procedure/runs");
  const runDir = runs.split("\n").find(f => f.includes("soft_"));
  const run = parseProcedureRun(await box.read(runDir + "/run.procedure-run.card"));
  t.check({ result, files, steps: run?.steps }, {
    result: { ok: true, value: { status: "completed", procedure: "soft", inconclusive: [] } },
    files: `_bookkeeping/output/.gitkeep
_bookkeeping/output/after.txt
_bookkeeping/output/messy.txt`,
    steps: [
      {
        id: "lax",
        status: "completed",
        ...stamps,
        run: { "session-id": sessionId, "git-ref": gitRef },
        validate: { status: "warn", review: "Not tidy, but non-blocking." },
      },
      { id: "after", status: "completed", ...stamps, run: { "git-ref": gitRef } },
    ],
  });
});

// ## An inconclusive judge under `abort` does NOT fail the step
//
// The judge never reaches a verdict (it exhausts its turn cap on both attempts).
// `severity: abort` hard-gates a *failing* check — and a check that never decided
// has not failed. So the work stands, the following step runs, and the run's
// terminal status is `inconclusive`: honest about what is and isn't known, rather
// than reporting a non-answer as a verdict in either direction.
void test("The judge never reaches a verdict (it exhausts its turn cap on both attempts).", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await box.write("_config/procedures/unjudged.procedure.card", `---
name: unjudged
description: The judge runs out of turns
steps:
  - id: checked
    description: Work succeeds, review never decides
    run:
      agents:
        - prompt: Do work.
    validate:
      severity: abort
      instructions:
        - The work must be complete.
  - id: after
    description: Runs anyway — nothing failed
    run:
      shells:
        - |
          echo "ran" > _bookkeeping/output/after.txt
---
`);
  await box.write("_bookkeeping/output/.gitkeep", "");
  box.commitAll("Add unjudged procedure");

  let workAgentRuns = 0;
  const createAgent: AgentFactory = (opts) => createFakeAgent({
    name: opts.name,
    act: async () => {
      workAgentRuns++;
      await box.write("_bookkeeping/output/done.txt", "all done");
      box.commitAll("agent work");
      return { success: true };
    },
    structuredResult: () => null,
    structuredFailure: { error: "error_max_turns" },
  });

  const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
  const result = await startProcedure({
    ctx,
    procedureNameOrPath: "unjudged",
    options: { createAgent },
  });
  const files = await box.list("_bookkeeping/output");

  const runs = await box.list("_bookkeeping/procedure/runs");
  const runDir = runs.split("\n").find(f => f.includes("unjudged_"));
  const run = parseProcedureRun(await box.read(runDir + "/run.procedure-run.card"));
  // The work agent ran once. Redoing finished work because the CHECKER ran out
  // of budget is the exact confusion this state exists to end.
  t.check({ result, workAgentRuns, files, outcome: run?.outcome, steps: run?.steps }, {
    result: {
      ok: true,
      value: {
        status: "inconclusive",
        procedure: "unjudged",
        inconclusive: [{ stepId: "checked", reason: "max-turns", detail: "reached max turns (16)" }],
      },
    },
    workAgentRuns: 1,
    files: `_bookkeeping/output/.gitkeep
_bookkeeping/output/after.txt
_bookkeeping/output/done.txt`,
    outcome: "inconclusive",
    steps: [
      {
        id: "checked",
        status: "completed",
        ...stamps,
        run: { "session-id": sessionId, "git-ref": gitRef },
        validate: {
          status: "inconclusive",
          review: "Instruction validation was inconclusive: the review reached max turns (16). The work was not judged — it is neither approved nor rejected.",
          error: "Review reached max turns (16) — the work was not judged.",
          reason: "max-turns",
        },
      },
      { id: "after", status: "completed", ...stamps, run: { "git-ref": gitRef } },
    ],
  });

  // The CLI re-validates the outcome across the untyped command-runner
  // boundary before keying its exit code on it.
  const crossed = procedureOutcome({ success: true, data: valueOf(result) });
  assert.ok(crossed);
  const crossedStep = crossed.inconclusive[0];
  assert.ok(crossedStep);
  await t.checkText(
    formatInconclusiveLine({
      procedure: crossed.procedure,
      stepId: crossedStep.stepId,
      detail: crossedStep.detail,
    }),
    "Inconclusive: procedure unjudged — review of step checked reached max turns (16); work completed",
  );
});
