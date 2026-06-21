# Procedure Engine

Tests for the procedure engine — parsing definitions, executing steps,
tracking state in run cards, and handling various step outcomes.

```ts setup
import { startProcedure } from "../../../src/core/procedure/engine.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { getLog } from "../../../src/cli/lib/git.js";
import { parseProcedureRun } from "../../../src/schemas/procedure-run.js";
```

## Shell-only procedure: happy path

A procedure with a single shell step runs to completion. The engine
creates a run directory, commits at each phase boundary, and records
results in the run card.

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/greet.procedure.card", `---
name: greet
description: A simple greeting procedure
steps:
  - id: hello
    description: Say hello
    run:
      shells:
        - |
          echo "Hello from procedure" > box/output/greeting.txt
---
`);
await box.write("box/output/.gitkeep", "");
box.commitAll("Add greet procedure");

const output = [];
const ctx = { boxRoot: box.root, writeLine: (s) => output.push(s), write: (s) => {} };
const result = await startProcedure({ ctx, procedureNameOrPath: "greet" });
print(`success: ${result.success}`);

// The greeting file was created by the shell step
const greeting = await box.read("box/output/greeting.txt");
print(`greeting: ${greeting.trim()}`);

// Run card exists and shows completed
const runs = await box.list("procedure/runs");
const runDir = runs.split("\n").find(f => f.includes("greet_"));
const runCard = await box.read(runDir + "/run.procedure-run.card");
const run = parseProcedureRun(runCard);
print(`procedure status: ${run.status}`);
print(`step status: ${run.steps[0].status}`);
=>
success: true
greeting: Hello from procedure
procedure status: completed
step status: completed
```

```ts cleanup
await box.cleanup();
```

## Precheck skip

When a precheck exits with `$CHECK_SKIP`, the step is skipped — not
failed. The procedure continues to the next step.

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/maybe.procedure.card", `---
name: maybe
description: Conditional steps
steps:
  - id: skipped
    description: This step skips
    precheck:
      shells:
        - |
          exit $CHECK_SKIP
    run:
      shells:
        - |
          echo "SHOULD NOT RUN" > box/output/bad.txt
  - id: runs
    description: This step runs
    run:
      shells:
        - |
          echo "OK" > box/output/good.txt
---
`);
await box.write("box/output/.gitkeep", "");
box.commitAll("Add maybe procedure");

const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
const result = await startProcedure({ ctx, procedureNameOrPath: "maybe" });
print(`success: ${result.success}`);

// The skipped step's shell never ran
const files = await box.list("box/output");
print(`bad.txt exists: ${files.includes("bad.txt")}`);
print(`good.txt exists: ${files.includes("good.txt")}`);

// Run card shows skip + completed
const runs = await box.list("procedure/runs");
const runDir = runs.split("\n").find(f => f.includes("maybe_"));
const runCard = await box.read(runDir + "/run.procedure-run.card");
const run = parseProcedureRun(runCard);
print(`skipped step: ${run.steps[0].id} = ${run.steps[0].status}`);
print(`runs step: ${run.steps[1].id} = ${run.steps[1].status}`);
=>
success: true
bad.txt exists: false
good.txt exists: true
skipped step: skipped = skipped
runs step: runs = completed
```

```ts cleanup
await box.cleanup();
```

## No-op run leaves nothing behind

When every step skips, the run was a no-op: the run directory is removed
at completion and no commits are made. Provenance for no-op ticks lives in
scheduler.jsonl, not in a dir-per-nothing.

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/idle.procedure.card", `---
name: idle
description: Nothing to do
steps:
  - id: first
    description: Skips
    precheck:
      shells:
        - |
          echo "nothing new"; exit $CHECK_SKIP
    run:
      shells:
        - |
          echo "NEVER" > box/output/never.txt
  - id: second
    description: Also skips
    precheck:
      shells:
        - |
          exit $CHECK_SKIP
    run:
      shells:
        - |
          echo "ALSO NEVER" > box/output/also.txt
---
`);
box.commitAll("Add idle procedure");

const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
const result = await startProcedure({ ctx, procedureNameOrPath: "idle" });
print(`success: ${result.success}`);

// No run directory persists
const runs = await box.list("procedure/runs");
print(`runs dir contents: "${runs}"`);

// And no commits beyond init + the procedure card itself
const log = await getLog(box.root);
print(`commits: ${log.length}`);
=>
success: true
runs dir contents: ""
commits: 2
```

```ts cleanup
await box.cleanup();
```

## Precheck failure stops the procedure

When a precheck exits with a non-zero, non-skip code, the step fails
and the procedure halts — later steps don't run.

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/fail-early.procedure.card", `---
name: fail-early
description: First step fails
steps:
  - id: broken
    description: Precheck fails
    precheck:
      shells:
        - |
          echo "something wrong"; exit 1
    run:
      shells:
        - |
          echo "NEVER" > box/output/never.txt
  - id: after
    description: Should not run
    run:
      shells:
        - |
          echo "ALSO NEVER" > box/output/also.txt
---
`);
await box.write("box/output/.gitkeep", "");
box.commitAll("Add fail-early procedure");

const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
const result = await startProcedure({ ctx, procedureNameOrPath: "fail-early" });
print(`success: ${result.success}`);

// Neither step's run phase executed
const files = await box.list("box/output");
print(`never.txt exists: ${files.includes("never.txt")}`);
print(`also.txt exists: ${files.includes("also.txt")}`);
=>
success: false
never.txt exists: false
also.txt exists: false
```

```ts cleanup
await box.cleanup();
```

## Validation with severity

Validation shells run after the step's run phase. `severity="warn"`
lets the procedure continue; `severity="abort"` stops it.

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/validate.procedure.card", `---
name: validate
description: Validation test
steps:
  - id: warned
    description: Validation warns but continues
    run:
      shells:
        - |
          echo "did work" > box/output/work.txt
    validate:
      severity: warn
      shells:
        - |
          echo "not ideal"; exit 1
  - id: after-warn
    description: Runs after warning
    run:
      shells:
        - |
          echo "still going" > box/output/still.txt
---
`);
await box.write("box/output/.gitkeep", "");
box.commitAll("Add validate procedure");

const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
const result = await startProcedure({ ctx, procedureNameOrPath: "validate" });
print(`success: ${result.success}`);

// Both steps ran despite validation warning
const files = await box.list("box/output");
print(`work.txt: ${files.includes("work.txt")}`);
print(`still.txt: ${files.includes("still.txt")}`);

// Check the validate result in run card
const runs = await box.list("procedure/runs");
const runDir = runs.split("\n").find(f => f.includes("validate_"));
const runCard = await box.read(runDir + "/run.procedure-run.card");
const run = parseProcedureRun(runCard);
const warnedStep = run.steps.find(s => s.id === "warned");
print(`validate status: ${warnedStep.validate.status}`);
=>
success: true
work.txt: true
still.txt: true
validate status: warn
```

```ts cleanup
await box.cleanup();
```

## Abort validation stops the procedure

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/abort.procedure.card", `---
name: abort
description: Abort on validation failure
steps:
  - id: checked
    description: Validation aborts
    run:
      shells:
        - |
          echo "ran" > box/output/ran.txt
    validate:
      severity: abort
      shells:
        - |
          echo "bad output"; exit 1
  - id: never
    description: Should not run
    run:
      shells:
        - |
          echo "nope" > box/output/nope.txt
---
`);
await box.write("box/output/.gitkeep", "");
box.commitAll("Add abort procedure");

const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
const result = await startProcedure({ ctx, procedureNameOrPath: "abort" });
print(`success: ${result.success}`);

const files = await box.list("box/output");
print(`ran.txt: ${files.includes("ran.txt")}`);
print(`nope.txt: ${files.includes("nope.txt")}`);
=>
success: false
ran.txt: true
nope.txt: false
```

```ts cleanup
await box.cleanup();
```

## Dry run previews without executing

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/preview.procedure.card", `---
name: preview
description: Preview procedure
steps:
  - id: first
    description: First step
    precheck:
      shells:
        - |
          true
    run:
      shells:
        - |
          echo "side effect" > box/output/effect.txt
    validate:
      severity: warn
      shells:
        - |
          true
  - id: second
    description: Second step
    run:
      agents:
        - prompt: Do something
---
`);
box.commitAll("Add preview procedure");

const output = [];
const ctx = { boxRoot: box.root, writeLine: (s) => output.push(s), write: () => {} };
const result = await startProcedure({
  ctx,
  procedureNameOrPath: "preview",
  options: { dryRun: true },
});
print(`success: ${result.success}`);

// No side effects — box/output was never created
const hasOutput = await box.list("box/output");
print(`output dir empty: ${hasOutput === ""}`);

// Output describes the steps
const stepLines = output.filter(s => s.includes("first") || s.includes("second"));
print(`mentions steps: ${stepLines.length >= 2}`);
=>
success: true
output dir empty: true
mentions steps: true
```

```ts cleanup
await box.cleanup();
```

## Step filtering with --step

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/multi.procedure.card", `---
name: multi
description: Multi-step
steps:
  - id: alpha
    description: Alpha
    run:
      shells:
        - |
          echo "a" > box/output/a.txt
  - id: beta
    description: Beta
    run:
      shells:
        - |
          echo "b" > box/output/b.txt
---
`);
await box.write("box/output/.gitkeep", "");
box.commitAll("Add multi procedure");

const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
const result = await startProcedure({
  ctx,
  procedureNameOrPath: "multi",
  options: { step: "beta" },
});
print(`success: ${result.success}`);

const files = await box.list("box/output");
print(`a.txt: ${files.includes("a.txt")}`);
print(`b.txt: ${files.includes("b.txt")}`);
=>
success: true
a.txt: false
b.txt: true
```

```ts cleanup
await box.cleanup();
```

## Missing procedure returns error

```ts
const box = await makeTmpBox({ git: true });
const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
const result = await startProcedure({ ctx, procedureNameOrPath: "nonexistent" });
print(`success: ${result.success}`);
print(`has error: ${result.error?.includes("not found") ?? false}`);
=>
success: false
has error: true
```

```ts cleanup
await box.cleanup();
```

## Finished runs carry an expires stamp

At completion the engine stamps `expires` on the run card — completed-at
plus 30 days for completed runs, 90 days for failed runs. `cb procedure gc`
deletes run dirs past their stamp; anyone can edit the attribute to pin or
extend a specific run.

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/stamped.procedure.card", `---
name: stamped
description: Gets an expires stamp
steps:
  - id: work
    description: Does work
    run:
      shells:
        - |
          echo "did it" > box/output/did.txt
---
`);
await box.write("config/procedures/doomed.procedure.card", `---
name: doomed
description: Fails
steps:
  - id: broken
    description: Precheck fails
    precheck:
      shells:
        - |
          exit 1
    run:
      shells:
        - |
          true
---
`);
await box.write("box/output/.gitkeep", "");
box.commitAll("Add procedures");

const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
await startProcedure({ ctx, procedureNameOrPath: "stamped" });
await startProcedure({ ctx, procedureNameOrPath: "doomed" });

const runs = (await box.list("procedure/runs")).split("\n");
const dayMs = 24 * 60 * 60 * 1000;

const okDir = runs.find(f => f.includes("stamped_"));
const okRun = parseProcedureRun(await box.read(okDir + "/run.procedure-run.card"));
const okDays = (Date.parse(okRun.expires) - Date.parse(okRun["completed-at"])) / dayMs;
print(`completed run expires after: ${Math.round(okDays)}d`);

const badDir = runs.find(f => f.includes("doomed_"));
const badRun = parseProcedureRun(await box.read(badDir + "/run.procedure-run.card"));
const badDays = (Date.parse(badRun.expires) - Date.parse(badRun["completed-at"])) / dayMs;
print(`failed run status: ${badRun.status}, expires after: ${Math.round(badDays)}d`);
=>
completed run expires after: 30d
failed run status: failed, expires after: 90d
```

```ts cleanup
await box.cleanup();
```

## Procedure cards can override run expiry

`run-expiry` / `failed-run-expiry` attributes on the procedure definition
override the defaults; "never" pins every run of that procedure.

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/keeper.procedure.card", `---
name: keeper
run-expiry: never
description: Runs are kept forever
steps:
  - id: work
    description: Does work
    run:
      shells:
        - |
          echo "kept" > box/output/kept.txt
---
`);
await box.write("box/output/.gitkeep", "");
box.commitAll("Add keeper procedure");

const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
const result = await startProcedure({ ctx, procedureNameOrPath: "keeper" });
print(`success: ${result.success}`);

const runs = (await box.list("procedure/runs")).split("\n");
const runDir = runs.find(f => f.includes("keeper_"));
const run = parseProcedureRun(await box.read(runDir + "/run.procedure-run.card"));
print(`expires: ${run.expires}`);
=>
success: true
expires: never
```

```ts cleanup
await box.cleanup();
```

## Invalid --step returns error

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/steps.procedure.card", `---
name: steps
description: Has steps
steps:
  - id: real
    description: Real
    run:
      shells:
        - |
          true
---
`);
box.commitAll("Add steps procedure");

const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
const result = await startProcedure({
  ctx,
  procedureNameOrPath: "steps",
  options: { step: "fake" },
});
print(`success: ${result.success}`);
print(`mentions available: ${result.error?.includes("real") ?? false}`);
=>
success: false
mentions available: true
```

```ts cleanup
await box.cleanup();
```
