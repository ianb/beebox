# Procedure Engine

Tests for the procedure engine — parsing definitions, executing steps,
tracking state in run cards, and handling various step outcomes.

```ts setup
import { startProcedure } from "../src/core/procedure/engine.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import { getLog } from "../src/cli/lib/git.js";
import { parseCard } from "cardworks";
```

## Shell-only procedure: happy path

A procedure with a single shell step runs to completion. The engine
creates a run directory, commits at each phase boundary, and records
results in the run card.

```
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/greet.procedure.card", `
<procedure name="greet">
  <description>A simple greeting procedure</description>
  <step id="hello">
    <description>Say hello</description>
    <run>
      <shell>echo "Hello from procedure" > box/output/greeting.txt</shell>
    </run>
  </step>
</procedure>
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
const root = await parseCard(runCard, { source: "run.card" });
print(`procedure status: ${root.attrs["status"]}`);
print(`step status: ${root.children[0].attrs["status"]}`);
=>
success: true
greeting: Hello from procedure
procedure status: completed
step status: completed
```

``` cleanup
await box.cleanup();
```

## Precheck skip

When a precheck exits with `$CHECK_SKIP`, the step is skipped — not
failed. The procedure continues to the next step.

```
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/maybe.procedure.card", `
<procedure name="maybe">
  <description>Conditional steps</description>
  <step id="skipped">
    <description>This step skips</description>
    <precheck>
      <shell>exit $CHECK_SKIP</shell>
    </precheck>
    <run>
      <shell>echo "SHOULD NOT RUN" > box/output/bad.txt</shell>
    </run>
  </step>
  <step id="runs">
    <description>This step runs</description>
    <run>
      <shell>echo "OK" > box/output/good.txt</shell>
    </run>
  </step>
</procedure>
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
const root = await parseCard(runCard, { source: "run.card" });
const steps = root.children.filter(c => c.tagName === "step");
print(`skipped step: ${steps[0].attrs["id"]} = ${steps[0].attrs["status"]}`);
print(`runs step: ${steps[1].attrs["id"]} = ${steps[1].attrs["status"]}`);
=>
success: true
bad.txt exists: false
good.txt exists: true
skipped step: skipped = skipped
runs step: runs = completed
```

``` cleanup
await box.cleanup();
```

## No-op run leaves nothing behind

When every step skips, the run was a no-op: the run directory is removed
at completion and no commits are made. Provenance for no-op ticks lives in
scheduler.jsonl, not in a dir-per-nothing.

```
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/idle.procedure.card", `
<procedure name="idle">
  <description>Nothing to do</description>
  <step id="first">
    <description>Skips</description>
    <precheck>
      <shell>echo "nothing new"; exit $CHECK_SKIP</shell>
    </precheck>
    <run><shell>echo "NEVER" > box/output/never.txt</shell></run>
  </step>
  <step id="second">
    <description>Also skips</description>
    <precheck>
      <shell>exit $CHECK_SKIP</shell>
    </precheck>
    <run><shell>echo "ALSO NEVER" > box/output/also.txt</shell></run>
  </step>
</procedure>
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

``` cleanup
await box.cleanup();
```

## Precheck failure stops the procedure

When a precheck exits with a non-zero, non-skip code, the step fails
and the procedure halts — later steps don't run.

```
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/fail-early.procedure.card", `
<procedure name="fail-early">
  <description>First step fails</description>
  <step id="broken">
    <description>Precheck fails</description>
    <precheck>
      <shell>echo "something wrong"; exit 1</shell>
    </precheck>
    <run>
      <shell>echo "NEVER" > box/output/never.txt</shell>
    </run>
  </step>
  <step id="after">
    <description>Should not run</description>
    <run>
      <shell>echo "ALSO NEVER" > box/output/also.txt</shell>
    </run>
  </step>
</procedure>
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

``` cleanup
await box.cleanup();
```

## Validation with severity

Validation shells run after the step's run phase. `severity="warn"`
lets the procedure continue; `severity="abort"` stops it.

```
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/validate.procedure.card", `
<procedure name="validate">
  <description>Validation test</description>
  <step id="warned">
    <description>Validation warns but continues</description>
    <run>
      <shell>echo "did work" > box/output/work.txt</shell>
    </run>
    <validate severity="warn">
      <shell>echo "not ideal"; exit 1</shell>
    </validate>
  </step>
  <step id="after-warn">
    <description>Runs after warning</description>
    <run>
      <shell>echo "still going" > box/output/still.txt</shell>
    </run>
  </step>
</procedure>
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
const root = await parseCard(runCard, { source: "run.card" });
const warnedStep = root.children.find(c => c.attrs?.["id"] === "warned");
const valEl = warnedStep.children.find(c => c.tagName === "validate");
print(`validate status: ${valEl.attrs["status"]}`);
=>
success: true
work.txt: true
still.txt: true
validate status: warn
```

``` cleanup
await box.cleanup();
```

## Abort validation stops the procedure

```
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/abort.procedure.card", `
<procedure name="abort">
  <description>Abort on validation failure</description>
  <step id="checked">
    <description>Validation aborts</description>
    <run>
      <shell>echo "ran" > box/output/ran.txt</shell>
    </run>
    <validate severity="abort">
      <shell>echo "bad output"; exit 1</shell>
    </validate>
  </step>
  <step id="never">
    <description>Should not run</description>
    <run>
      <shell>echo "nope" > box/output/nope.txt</shell>
    </run>
  </step>
</procedure>
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

``` cleanup
await box.cleanup();
```

## Dry run previews without executing

```
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/preview.procedure.card", `
<procedure name="preview">
  <description>Preview procedure</description>
  <step id="first">
    <description>First step</description>
    <precheck><shell>true</shell></precheck>
    <run>
      <shell>echo "side effect" > box/output/effect.txt</shell>
    </run>
    <validate severity="warn"><shell>true</shell></validate>
  </step>
  <step id="second">
    <description>Second step</description>
    <run>
      <agent>Do something</agent>
    </run>
  </step>
</procedure>
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

``` cleanup
await box.cleanup();
```

## Step filtering with --step

```
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/multi.procedure.card", `
<procedure name="multi">
  <description>Multi-step</description>
  <step id="alpha">
    <description>Alpha</description>
    <run><shell>echo "a" > box/output/a.txt</shell></run>
  </step>
  <step id="beta">
    <description>Beta</description>
    <run><shell>echo "b" > box/output/b.txt</shell></run>
  </step>
</procedure>
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

``` cleanup
await box.cleanup();
```

## Missing procedure returns error

```
const box = await makeTmpBox({ git: true });
const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
const result = await startProcedure({ ctx, procedureNameOrPath: "nonexistent" });
print(`success: ${result.success}`);
print(`has error: ${result.error?.includes("not found") ?? false}`);
=>
success: false
has error: true
```

``` cleanup
await box.cleanup();
```

## Finished runs carry an expires stamp

At completion the engine stamps `expires` on the run card — completed-at
plus 30 days for completed runs, 90 days for failed runs. `cb procedure gc`
deletes run dirs past their stamp; anyone can edit the attribute to pin or
extend a specific run.

```
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/stamped.procedure.card", `
<procedure name="stamped">
  <description>Gets an expires stamp</description>
  <step id="work">
    <description>Does work</description>
    <run><shell>echo "did it" > box/output/did.txt</shell></run>
  </step>
</procedure>
`);
await box.write("config/procedures/doomed.procedure.card", `
<procedure name="doomed">
  <description>Fails</description>
  <step id="broken">
    <description>Precheck fails</description>
    <precheck><shell>exit 1</shell></precheck>
    <run><shell>true</shell></run>
  </step>
</procedure>
`);
await box.write("box/output/.gitkeep", "");
box.commitAll("Add procedures");

const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
await startProcedure({ ctx, procedureNameOrPath: "stamped" });
await startProcedure({ ctx, procedureNameOrPath: "doomed" });

const runs = (await box.list("procedure/runs")).split("\n");
const dayMs = 24 * 60 * 60 * 1000;

const okDir = runs.find(f => f.includes("stamped_"));
const okRoot = await parseCard(await box.read(okDir + "/run.procedure-run.card"), { source: "ok" });
const okDays = (Date.parse(okRoot.attrs["expires"]) - Date.parse(okRoot.attrs["completed-at"])) / dayMs;
print(`completed run expires after: ${Math.round(okDays)}d`);

const badDir = runs.find(f => f.includes("doomed_"));
const badRoot = await parseCard(await box.read(badDir + "/run.procedure-run.card"), { source: "bad" });
const badDays = (Date.parse(badRoot.attrs["expires"]) - Date.parse(badRoot.attrs["completed-at"])) / dayMs;
print(`failed run status: ${badRoot.attrs["status"]}, expires after: ${Math.round(badDays)}d`);
=>
completed run expires after: 30d
failed run status: failed, expires after: 90d
```

``` cleanup
await box.cleanup();
```

## Procedure cards can override run expiry

`run-expiry` / `failed-run-expiry` attributes on the procedure definition
override the defaults; "never" pins every run of that procedure.

```
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/keeper.procedure.card", `
<procedure name="keeper" run-expiry="never">
  <description>Runs are kept forever</description>
  <step id="work">
    <description>Does work</description>
    <run><shell>echo "kept" > box/output/kept.txt</shell></run>
  </step>
</procedure>
`);
await box.write("box/output/.gitkeep", "");
box.commitAll("Add keeper procedure");

const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
const result = await startProcedure({ ctx, procedureNameOrPath: "keeper" });
print(`success: ${result.success}`);

const runs = (await box.list("procedure/runs")).split("\n");
const runDir = runs.find(f => f.includes("keeper_"));
const root = await parseCard(await box.read(runDir + "/run.procedure-run.card"), { source: "run" });
print(`expires: ${root.attrs["expires"]}`);
=>
success: true
expires: never
```

``` cleanup
await box.cleanup();
```

## Invalid --step returns error

```
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/steps.procedure.card", `
<procedure name="steps">
  <description>Has steps</description>
  <step id="real"><description>Real</description><run><shell>true</shell></run></step>
</procedure>
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

``` cleanup
await box.cleanup();
```
