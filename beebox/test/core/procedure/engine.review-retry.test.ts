// # Procedure Engine: `severity: review` Auto-Retry
//
// `severity: review` now tries to self-heal a failing validation by re-invoking the
// run agent with the failure context, up to `MAX_REVIEW_RETRIES` times, then gates
// (fails the step) if it still doesn't pass. Run shells run once and are never
// repeated on a retry. The fake agent both does the run-phase work (`act`) and
// returns the scripted verdict (`structuredResult`).

import { test } from "tap";
import "agent-doctest/tap";
import { any, isoDate } from "agent-doctest/check";
import type { AgentFactory } from "../../../src/core/procedure/engine-types.js";
import { startProcedure } from "../../../src/core/procedure/engine/core.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { createFakeAgent } from "../fake-agent.js";
import { parseProcedureRun } from "../../../src/schemas/procedure-run.js";

// Session ids and git refs in a run card are minted per run.
const sessionId = any(String).startsWith("fake-");
const gitRef = any(String).matches(/^[\da-f]{40}$/);

// ## Retry then pass
//
// The judge fails the first time and passes after the agent re-runs. The step
// completes; the retry invocation carried the `<validation-failure>` context.
void test("The judge fails the first time and passes after the agent re-runs.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L31
  const box = await makeTmpBox({ git: true });
  await box.write("_config/procedures/heal.procedure.card", `---
name: heal
description: Review heals on retry
steps:
  - id: fixme
    description: Agent fixes the work on retry
    run:
      agents:
        - prompt: Do the work.
    validate:
      severity: review
      instructions:
        - The work must be complete.
---
`);
  await box.write("_bookkeeping/output/.gitkeep", "");
  box.commitAll("Add heal procedure");

  let runCount = 0;
  let validateCount = 0;
  let retryPrompt = "";
  const createAgent: AgentFactory = (opts) => createFakeAgent({
    name: opts.name,
    act: async ({ prompt }) => {
      runCount++;
      if (prompt.includes("validation-failure")) retryPrompt = prompt;
      await box.write("_bookkeeping/output/work.txt", `attempt ${runCount}`);
      box.commitAll(`agent attempt ${runCount}`);
      return { success: true };
    },
    structuredResult: () => {
      validateCount++;
      return validateCount > 1
        ? { passed: true, reasoning: "Now complete." }
        : { passed: false, reasoning: "Still incomplete." };
    },
  });

  const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
  const result = await startProcedure({
    ctx,
    procedureNameOrPath: "heal",
    options: { createAgent },
  });
  // The retry invocation's prompt (a large generated text) carries the failure context.
  t.check(retryPrompt, any(String).includes("<validation-failure>"));

  const runs = await box.list("_bookkeeping/procedure/runs");
  const runDir = runs.split("\n").find(f => f.includes("heal_"));
  const run = parseProcedureRun(await box.read(runDir + "/run.procedure-run.card"));
  t.check({ result, runCount, validateCount, step: run?.steps[0] }, {
    result: {
      ok: true,
      value: {
        status: "completed",
        procedure: "heal",
        inconclusive: [],
      },
    },
    runCount: 2,
    validateCount: 2,
    step: {
      id: "fixme",
      status: "completed",
      "started-at": isoDate(),
      "completed-at": isoDate(),
      run: {
        "session-id": sessionId,
        "git-ref": gitRef,
      },
      validate: {
        status: "pass",
        review: "Now complete.",
      },
    },
  });
});

// ## Exhaust retries then fail (review gates)
//
// The judge never passes. After `MAX_REVIEW_RETRIES` retries the step fails and the
// procedure halts.
void test("The judge never passes.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L105
  const box = await makeTmpBox({ git: true });
  await box.write("_config/procedures/stuck.procedure.card", `---
name: stuck
description: Review never heals
steps:
  - id: broken
    description: Agent can't satisfy validation
    run:
      agents:
        - prompt: Try.
    validate:
      severity: review
      instructions:
        - Impossible criterion.
  - id: after
    description: Should not run
    run:
      shells:
        - |
          echo "nope" > _bookkeeping/output/after.txt
---
`);
  await box.write("_bookkeeping/output/.gitkeep", "");
  box.commitAll("Add stuck procedure");

  let runCount = 0;
  const createAgent: AgentFactory = (opts) => createFakeAgent({
    name: opts.name,
    act: async () => {
      runCount++;
      await box.write("_bookkeeping/output/try.txt", `try ${runCount}`);
      box.commitAll(`agent try ${runCount}`);
      return { success: true };
    },
    structuredResult: () => ({ passed: false, reasoning: "Never satisfied." }),
  });

  const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
  const result = await startProcedure({
    ctx,
    procedureNameOrPath: "stuck",
    options: { createAgent },
  });
  const files = await box.list("_bookkeeping/output");

  const runs = await box.list("_bookkeeping/procedure/runs");
  const runDir = runs.split("\n").find(f => f.includes("stuck_"));
  const run = parseProcedureRun(await box.read(runDir + "/run.procedure-run.card"));
  // Initial run + MAX_REVIEW_RETRIES (1) retry = 2 agent runs; the next step never ran.
  t.check({ result, runCount, files, steps: run?.steps }, {
    result: {
      ok: false,
      error: {
        cause: "step-failed",
        message: "Procedure stuck failed at step: broken",
      },
    },
    runCount: 2,
    files: `_bookkeeping/output/.gitkeep
_bookkeeping/output/try.txt`,
    steps: [
      {
        id: "broken",
        status: "failed",
        "started-at": isoDate(),
        "completed-at": isoDate(),
        run: {
          "session-id": sessionId,
          "git-ref": gitRef,
        },
        validate: {
          status: "fail",
          review: "Never satisfied.",
        },
      },
      {
        id: "after",
        status: "pending",
      },
    ],
  });
});

// ## Review with no run agent fails (can't retry)
//
// `severity: review` on a run phase with no agent has no session to resume, so it
// fails terminally rather than silently warning.
void test("severity:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L178
  const box = await makeTmpBox({ git: true });
  await box.write("_config/procedures/noagent.procedure.card", `---
name: noagent
description: Review but no agent to retry
steps:
  - id: shellonly
    description: Shell-only run phase under review
    run:
      shells:
        - |
          echo "did something" > _bookkeeping/output/thing.txt
    validate:
      severity: review
      instructions:
        - Must meet the bar.
---
`);
  await box.write("_bookkeeping/output/.gitkeep", "");
  box.commitAll("Add noagent procedure");

  let validateCount = 0;
  const createAgent: AgentFactory = (opts) => createFakeAgent({
    name: opts.name,
    act: async () => ({ success: true }),
    structuredResult: () => {
      validateCount++;
      return { passed: false, reasoning: "Not met." };
    },
  });

  const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
  const result = await startProcedure({
    ctx,
    procedureNameOrPath: "noagent",
    options: { createAgent },
  });

  const runs = await box.list("_bookkeeping/procedure/runs");
  const runDir = runs.split("\n").find(f => f.includes("noagent_"));
  const run = parseProcedureRun(await box.read(runDir + "/run.procedure-run.card"));
  // Judged once; no retry attempted (nothing to resume).
  t.check({ result, validateCount, step: run?.steps[0] }, {
    result: {
      ok: false,
      error: {
        cause: "step-failed",
        message: "Procedure noagent failed at step: shellonly",
      },
    },
    validateCount: 1,
    step: {
      id: "shellonly",
      status: "failed",
      "started-at": isoDate(),
      "completed-at": isoDate(),
      run: {
        "git-ref": gitRef,
      },
      validate: {
        status: "fail",
        review: "Not met.",
      },
    },
  });
});

// ## Run shells run once across retries
//
// The run phase has an agent and a shell. On a review-retry only the agent re-runs;
// the shell (which appends a line) runs exactly once.
void test("The run phase has an agent and a shell.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L238
  const box = await makeTmpBox({ git: true });
  await box.write("_config/procedures/once.procedure.card", `---
name: once
description: Shell runs once even with retries
steps:
  - id: mix
    description: Agent retries, shell does not
    run:
      agents:
        - prompt: Do the work.
      shells:
        - |
          echo "shell-ran" >> _bookkeeping/output/count.txt
    validate:
      severity: review
      instructions:
        - Must be complete.
---
`);
  await box.write("_bookkeeping/output/.gitkeep", "");
  box.commitAll("Add once procedure");

  let validateCount = 0;
  const createAgent: AgentFactory = (opts) => createFakeAgent({
    name: opts.name,
    act: async () => {
      await box.write("_bookkeeping/output/agentwork.txt", "work");
      box.commitAll("agent work");
      return { success: true };
    },
    structuredResult: () => {
      validateCount++;
      return validateCount > 1
        ? { passed: true, reasoning: "Good now." }
        : { passed: false, reasoning: "Retry please." };
    },
  });

  const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
  const result = await startProcedure({
    ctx,
    procedureNameOrPath: "once",
    options: { createAgent },
  });
  // The shell appended exactly one line despite the retry.
  t.check({ result, count: await box.read("_bookkeeping/output/count.txt") }, {
    result: {
      ok: true,
      value: {
        status: "completed",
        procedure: "once",
        inconclusive: [],
      },
    },
    count: "shell-ran\n",
  });
});

// ## An inconclusive judge never re-runs the work agent
//
// `severity: review` heals a *failing* verdict by re-invoking the run agent with
// the failure context. A judge that reached no verdict has nothing to hand it:
// there is no stated defect to fix, and the work is already done and committed.
// So the self-heal does not fire, the agent runs exactly once, and the run ends
// `inconclusive` — the check is retried, the work is not.
void test("severity: (line 305)", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L306
  const box = await makeTmpBox({ git: true });
  await box.write("_config/procedures/nodecide.procedure.card", `---
name: nodecide
description: Review never decides
steps:
  - id: work
    description: Work succeeds, judge exhausts its turns
    run:
      agents:
        - prompt: Do it.
    validate:
      severity: review
      instructions:
        - Some criterion.
---
`);
  await box.write("_bookkeeping/output/.gitkeep", "");
  box.commitAll("Add nodecide procedure");

  let runCount = 0;
  const createAgent: AgentFactory = (opts) => createFakeAgent({
    name: opts.name,
    act: async () => {
      runCount++;
      await box.write("_bookkeeping/output/try.txt", `try ${runCount}`);
      box.commitAll(`agent try ${runCount}`);
      return { success: true };
    },
    structuredResult: () => null,
    structuredFailure: { error: "error_max_turns" },
  });

  const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
  const result = await startProcedure({
    ctx,
    procedureNameOrPath: "nodecide",
    options: { createAgent },
  });

  const runs = await box.list("_bookkeeping/procedure/runs");
  const runDir = runs.split("\n").find(f => f.includes("nodecide_"));
  const run = parseProcedureRun(await box.read(runDir + "/run.procedure-run.card"));
  t.check({ result, runCount, step: run?.steps[0] }, {
    result: {
      ok: true,
      value: {
        status: "inconclusive",
        procedure: "nodecide",
        inconclusive: [
          {
            stepId: "work",
            reason: "max-turns",
            detail: "reached max turns (16)",
          },
        ],
      },
    },
    runCount: 1,
    step: {
      id: "work",
      status: "completed",
      "started-at": isoDate(),
      "completed-at": isoDate(),
      run: {
        "session-id": sessionId,
        "git-ref": gitRef,
      },
      validate: {
        status: "inconclusive",
        review: "Instruction validation was inconclusive: the review reached max turns (16). The work was not judged — it is neither approved nor rejected.",
        error: "Review reached max turns (16) — the work was not judged.",
        reason: "max-turns",
      },
    },
  });
});
