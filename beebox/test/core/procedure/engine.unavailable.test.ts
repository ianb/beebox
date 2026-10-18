// # Procedure Engine: deferred-recoverable engine failure
//
// When a run agent fails with `unavailability` (engine quota exhausted), the
// step fails immediately with the informative message: run shells don't run,
// validation doesn't run, and the `severity: review` retry loop is never
// entered — a retry into a dead engine cannot succeed, and a validation of the
// non-work would only produce a second, misleading error.
//
// Without this, an agent-level failure was only *logged*: the step ran its
// shells anyway and, absent a gating validation, reported **completed** — under
// quota exhaustion, a silently-successful no-op step.

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

const QUOTA_ERROR = "Codex is out of usage quota until Aug 19, 11:34 PM (account-level: affects every box and task using this Codex account). Provider message: You've hit your usage limit.";

const UNAVAILABILITY = {
  provider: "codex" as const,
  reason: "quota-exhausted" as const,
  retryAt: "2026-08-20T04:34:00.000Z",
  retryAtSource: "parsed" as const,
  detectedAt: "2026-08-18T19:00:00.000Z",
  message: "You've hit your usage limit.",
};


// ## The step fails with the cause; nothing retries after it
void test("The step fails with the cause; nothing retries after it", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L43
  const box = await makeTmpBox({ git: true });
  await box.write("_config/procedures/quota.procedure.card", `---
name: quota
description: Engine dies of quota exhaustion
steps:
  - id: work
    description: Agent hits the quota wall
    run:
      agents:
        - prompt: Do the work.
      shells:
        - echo "shell ran" > box/shell-ran.txt
    validate:
      severity: review
      instructions:
        - The work must be complete.
---
`);
  box.commitAll("Add quota procedure");

  let agentRuns = 0;
  let validateCalls = 0;
  const createAgent: AgentFactory = (opts) => createFakeAgent({
    name: opts.name,
    act: async () => {
      agentRuns++;
      return { success: false, error: QUOTA_ERROR, unavailability: UNAVAILABILITY };
    },
    structuredResult: () => {
      validateCalls++;
      return { passed: true, reasoning: "unreachable" };
    },
  });

  const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
  const result = await startProcedure({
    ctx,
    procedureNameOrPath: "quota",
    options: { createAgent },
  });
  const boxFiles = await box.list("box");

  const runs = await box.list("_bookkeeping/procedure/runs");
  const runDir = runs.split("\n").find(f => f.includes("quota_"));
  const run = parseProcedureRun(await box.read(runDir + "/run.procedure-run.card"));
  // Neither the shell nor the validation ran, and the step detail carries the cause.
  t.check({ result, agentRuns, validateCalls, boxFiles, step: run?.steps[0] }, {
    result: {
      ok: false,
      error: {
        cause: "step-failed",
        message: `Procedure quota failed at step: work — ${QUOTA_ERROR}`,
      },
    },
    agentRuns: 1,
    validateCalls: 0,
    boxFiles: "",
    step: {
      id: "work",
      status: "failed",
      "started-at": isoDate(),
      "completed-at": isoDate(),
      run: {
        "session-id": sessionId,
        stdout: QUOTA_ERROR,
        error: QUOTA_ERROR,
        "git-ref": gitRef,
      },
    },
  });
});
