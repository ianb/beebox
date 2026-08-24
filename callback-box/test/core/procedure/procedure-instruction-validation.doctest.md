# Procedure Engine: Instruction Validation (end-to-end)

`instructions:` in a `validate` phase are now evaluated by a review model against
the step's git diff, gated by `severity`. These tests drive a full
`startProcedure` with a fake agent that both does the run-phase work and returns
the scripted verdict for the validate-phase judge.

```ts setup
import { startProcedure } from "../../../src/core/procedure/engine.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { createFakeAgent } from "../../helpers/fake-agent.js";
import { parseProcedureRun } from "../../../src/schemas/procedure-run.js";
import { procedureOutcome } from "../../../src/core/commands/procedure.js";
import { formatInconclusiveLine } from "../../../src/shared/inconclusive.js";
```

## Passing instruction + the judge sees the whole multi-commit diff

The run agent makes **two** commits; the instruction judge must receive the
full `baseline..finalRef` range (both commits), not just the last one. The
verdict passes, so the step completes and the `review` reasoning is recorded.

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/instr.procedure.card", `---
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
await box.write("box/output/.gitkeep", "");
box.commitAll("Add instr procedure");

let judgePrompt;
const createAgent = (opts) => createFakeAgent({
  name: opts.name,
  act: async () => {
    await box.write("box/output/a.txt", "FIRST-CHANGE");
    box.commitAll("agent commit 1");
    await box.write("box/output/b.txt", "SECOND-CHANGE");
    box.commitAll("agent commit 2");
    return { success: true };
  },
  structuredResult: ({ systemPrompt }) => {
    judgePrompt = systemPrompt;
    return { passed: true, reasoning: "Both files are present in the diff." };
  },
});

const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
const result = await startProcedure({
  ctx,
  procedureNameOrPath: "instr",
  options: { createAgent },
});
print(`success: ${result.ok}`);

// The judge's diff spans BOTH agent commits, not just the last.
print(`diff has commit 1: ${judgePrompt.includes("FIRST-CHANGE")}`);
print(`diff has commit 2: ${judgePrompt.includes("SECOND-CHANGE")}`);

const runs = await box.list("procedure/runs");
const runDir = runs.split("\n").find(f => f.includes("instr_"));
const run = parseProcedureRun(await box.read(runDir + "/run.procedure-run.card"));
print(`step status: ${run.steps[0].status}`);
print(`validate status: ${run.steps[0].validate.status}`);
print(`review recorded: ${run.steps[0].validate.review}`);
=>
success: true
diff has commit 1: true
diff has commit 2: true
step status: completed
validate status: pass
review recorded: Both files are present in the diff.
```

```ts cleanup
await box.cleanup();
```

## Failing instruction under `abort` fails the step and halts

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/gate.procedure.card", `---
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
          echo "nope" > box/output/nope.txt
---
`);
await box.write("box/output/.gitkeep", "");
box.commitAll("Add gate procedure");

const createAgent = (opts) => createFakeAgent({
  name: opts.name,
  act: async () => {
    await box.write("box/output/partial.txt", "half done");
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
print(`success: ${result.ok}`);

const files = await box.list("box/output");
print(`nope.txt (second step) exists: ${files.includes("nope.txt")}`);

const runs = await box.list("procedure/runs");
const runDir = runs.split("\n").find(f => f.includes("gate_"));
const run = parseProcedureRun(await box.read(runDir + "/run.procedure-run.card"));
print(`checked step: ${run.steps[0].status}`);
print(`validate status: ${run.steps[0].validate.status}`);
=>
success: false
nope.txt (second step) exists: false
checked step: failed
validate status: fail
```

```ts cleanup
await box.cleanup();
```

## Failing instruction under `warn` continues

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/soft.procedure.card", `---
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
          echo "ok" > box/output/after.txt
---
`);
await box.write("box/output/.gitkeep", "");
box.commitAll("Add soft procedure");

const createAgent = (opts) => createFakeAgent({
  name: opts.name,
  act: async () => {
    await box.write("box/output/messy.txt", "eh");
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
print(`success: ${result.ok}`);

const files = await box.list("box/output");
print(`after.txt exists: ${files.includes("after.txt")}`);

const runs = await box.list("procedure/runs");
const runDir = runs.split("\n").find(f => f.includes("soft_"));
const run = parseProcedureRun(await box.read(runDir + "/run.procedure-run.card"));
print(`lax step: ${run.steps[0].status}`);
print(`validate status: ${run.steps[0].validate.status}`);
=>
success: true
after.txt exists: true
lax step: completed
validate status: warn
```

```ts cleanup
await box.cleanup();
```

## An inconclusive judge under `abort` does NOT fail the step

The judge never reaches a verdict (it exhausts its turn cap on both attempts).
`severity: abort` hard-gates a *failing* check — and a check that never decided
has not failed. So the work stands, the following step runs, and the run's
terminal status is `inconclusive`: honest about what is and isn't known, rather
than reporting a non-answer as a verdict in either direction.

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/unjudged.procedure.card", `---
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
          echo "ran" > box/output/after.txt
---
`);
await box.write("box/output/.gitkeep", "");
box.commitAll("Add unjudged procedure");

let workAgentRuns = 0;
const createAgent = (opts) => createFakeAgent({
  name: opts.name,
  act: async () => {
    workAgentRuns++;
    await box.write("box/output/done.txt", "all done");
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
print(`success: ${result.ok}`);
print(`run status: ${result.value.status}`);
print(`inconclusive step: ${result.value.inconclusive[0].stepId}`);
print(`reason: ${result.value.inconclusive[0].reason}`);
print(`detail: ${result.value.inconclusive[0].detail}`);

// The work agent ran once. Redoing finished work because the CHECKER ran out
// of budget is the exact confusion this state exists to end.
print(`work agent invocations: ${workAgentRuns}`);

const files = await box.list("box/output");
print(`after.txt (second step) exists: ${files.includes("after.txt")}`);

const runs = await box.list("procedure/runs");
const runDir = runs.split("\n").find(f => f.includes("unjudged_"));
const run = parseProcedureRun(await box.read(runDir + "/run.procedure-run.card"));
print(`card run status: ${run.status}`);
print(`checked step: ${run.steps[0].status}`);
print(`validate status: ${run.steps[0].validate.status}`);
print(`validate error: ${run.steps[0].validate.error}`);

// The CLI re-validates the outcome across the untyped command-runner
// boundary before keying its exit code on it.
const crossed = procedureOutcome({ success: true, data: result.value });
print(formatInconclusiveLine({
  procedure: crossed.procedure,
  stepId: crossed.inconclusive[0].stepId,
  detail: crossed.inconclusive[0].detail,
}));
=>
success: true
run status: inconclusive
inconclusive step: checked
reason: max-turns
detail: reached max turns (16)
work agent invocations: 1
after.txt (second step) exists: true
card run status: inconclusive
checked step: completed
validate status: inconclusive
validate error: Review reached max turns (16) — the work was not judged.
Inconclusive: procedure unjudged — review of step checked reached max turns (16); work completed
```

```ts cleanup
await box.cleanup();
```
