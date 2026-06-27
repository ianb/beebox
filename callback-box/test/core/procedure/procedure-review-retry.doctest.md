# Procedure Engine: `severity: review` Auto-Retry

`severity: review` now tries to self-heal a failing validation by re-invoking the
run agent with the failure context, up to `MAX_REVIEW_RETRIES` times, then gates
(fails the step) if it still doesn't pass. Run shells run once and are never
repeated on a retry. The fake agent both does the run-phase work (`act`) and
returns the scripted verdict (`structuredResult`).

```ts setup
import { startProcedure } from "../../../src/core/procedure/engine.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { createFakeAgent } from "../../helpers/fake-agent.js";
import { parseProcedureRun } from "../../../src/schemas/procedure-run.js";
```

## Retry then pass

The judge fails the first time and passes after the agent re-runs. The step
completes; the retry invocation carried the `<validation-failure>` context.

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/heal.procedure.card", `---
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
await box.write("box/output/.gitkeep", "");
box.commitAll("Add heal procedure");

let runCount = 0;
let validateCount = 0;
let retryPrompt = "";
const createAgent = (opts) => createFakeAgent({
  name: opts.name,
  act: async ({ prompt }) => {
    runCount++;
    if (prompt.includes("validation-failure")) retryPrompt = prompt;
    await box.write("box/output/work.txt", `attempt ${runCount}`);
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
print(`success: ${result.success}`);
print(`agent runs: ${runCount}`);
print(`validate calls: ${validateCount}`);
print(`retry got failure context: ${retryPrompt.includes("<validation-failure>")}`);

const runs = await box.list("procedure/runs");
const runDir = runs.split("\n").find(f => f.includes("heal_"));
const run = parseProcedureRun(await box.read(runDir + "/run.procedure-run.card"));
print(`step status: ${run.steps[0].status}`);
print(`validate status: ${run.steps[0].validate.status}`);
=>
success: true
agent runs: 2
validate calls: 2
retry got failure context: true
step status: completed
validate status: pass
```

```ts cleanup
await box.cleanup();
```

## Exhaust retries then fail (review gates)

The judge never passes. After `MAX_REVIEW_RETRIES` retries the step fails and the
procedure halts.

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/stuck.procedure.card", `---
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
          echo "nope" > box/output/after.txt
---
`);
await box.write("box/output/.gitkeep", "");
box.commitAll("Add stuck procedure");

let runCount = 0;
const createAgent = (opts) => createFakeAgent({
  name: opts.name,
  act: async () => {
    runCount++;
    await box.write("box/output/try.txt", `try ${runCount}`);
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
print(`success: ${result.success}`);
// Initial run + MAX_REVIEW_RETRIES (1) retry = 2 agent runs.
print(`agent runs: ${runCount}`);

const files = await box.list("box/output");
print(`after.txt (next step) exists: ${files.includes("after.txt")}`);

const runs = await box.list("procedure/runs");
const runDir = runs.split("\n").find(f => f.includes("stuck_"));
const run = parseProcedureRun(await box.read(runDir + "/run.procedure-run.card"));
print(`broken step: ${run.steps[0].status}`);
print(`validate status: ${run.steps[0].validate.status}`);
=>
success: false
agent runs: 2
after.txt (next step) exists: false
broken step: failed
validate status: fail
```

```ts cleanup
await box.cleanup();
```

## Review with no run agent fails (can't retry)

`severity: review` on a run phase with no agent has no session to resume, so it
fails terminally rather than silently warning.

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/noagent.procedure.card", `---
name: noagent
description: Review but no agent to retry
steps:
  - id: shellonly
    description: Shell-only run phase under review
    run:
      shells:
        - |
          echo "did something" > box/output/thing.txt
    validate:
      severity: review
      instructions:
        - Must meet the bar.
---
`);
await box.write("box/output/.gitkeep", "");
box.commitAll("Add noagent procedure");

let validateCount = 0;
const createAgent = (opts) => createFakeAgent({
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
print(`success: ${result.success}`);
// Judged once; no retry attempted (nothing to resume).
print(`validate calls: ${validateCount}`);

const runs = await box.list("procedure/runs");
const runDir = runs.split("\n").find(f => f.includes("noagent_"));
const run = parseProcedureRun(await box.read(runDir + "/run.procedure-run.card"));
print(`step status: ${run.steps[0].status}`);
=>
success: false
validate calls: 1
step status: failed
```

```ts cleanup
await box.cleanup();
```

## Run shells run once across retries

The run phase has an agent and a shell. On a review-retry only the agent re-runs;
the shell (which appends a line) runs exactly once.

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/once.procedure.card", `---
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
          echo "shell-ran" >> box/output/count.txt
    validate:
      severity: review
      instructions:
        - Must be complete.
---
`);
await box.write("box/output/.gitkeep", "");
box.commitAll("Add once procedure");

let validateCount = 0;
const createAgent = (opts) => createFakeAgent({
  name: opts.name,
  act: async () => {
    await box.write("box/output/agentwork.txt", "work");
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
print(`success: ${result.success}`);

// The shell appended exactly one line despite the retry.
const count = await box.read("box/output/count.txt");
const lines = count.trim().split("\n").filter(Boolean);
print(`shell ran ${lines.length} time(s)`);
=>
success: true
shell ran 1 time(s)
```

```ts cleanup
await box.cleanup();
```
