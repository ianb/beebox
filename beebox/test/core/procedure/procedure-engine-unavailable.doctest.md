# Procedure Engine: deferred-recoverable engine failure

When a run agent fails with `unavailability` (engine quota exhausted), the
step fails immediately with the informative message: run shells don't run,
validation doesn't run, and the `severity: review` retry loop is never
entered — a retry into a dead engine cannot succeed, and a validation of the
non-work would only produce a second, misleading error.

Without this, an agent-level failure was only *logged*: the step ran its
shells anyway and, absent a gating validation, reported **completed** — under
quota exhaustion, a silently-successful no-op step.

```ts setup
import { startProcedure } from "../../../src/core/procedure/engine.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { createFakeAgent } from "../../helpers/fake-agent.js";
import { parseProcedureRun } from "../../../src/schemas/procedure-run.js";

const QUOTA_ERROR = "Codex is out of usage quota until Aug 19, 11:34 PM (account-level: affects every box and task using this Codex account). Provider message: You've hit your usage limit.";

const UNAVAILABILITY = {
  provider: "codex" as const,
  reason: "quota-exhausted" as const,
  retryAt: "2026-08-20T04:34:00.000Z",
  retryAtSource: "parsed" as const,
  detectedAt: "2026-08-18T19:00:00.000Z",
  message: "You've hit your usage limit.",
};
```

## The step fails with the cause; nothing retries after it

```ts
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
const createAgent = (opts) => createFakeAgent({
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
print(`success: ${result.ok}`);
print(`agent runs: ${agentRuns}`);
print(`validate calls: ${validateCalls}`);
const boxFiles = await box.list("box");
print(`shell ran: ${boxFiles.includes("shell-ran.txt")}`);

const runs = await box.list("_bookkeeping/procedure/runs");
const runDir = runs.split("\n").find(f => f.includes("quota_"));
const run = parseProcedureRun(await box.read(runDir + "/run.procedure-run.card"));
print(`step status: ${run.steps[0].status}`);
print(`step detail carries the cause: ${run.steps[0].run.stdout.includes("out of usage quota until")}`);
=>
success: false
agent runs: 1
validate calls: 0
shell ran: false
step status: failed
step detail carries the cause: true
```

```ts cleanup
await box.cleanup();
```
