# Procedure Engine: Agent Tests

Tests for agent injection in the procedure engine — mock runners,
directive passing, and fallback commits for uncommitted agent changes.

```ts setup
import { startProcedure } from "../../../src/core/procedure/engine.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { createFakeAgent } from "../../helpers/fake-agent.js";
import { execSync } from "node:child_process";
import { parseProcedureRun } from "../../../src/schemas/procedure-run.js";
```

## Agent step with mock runner

The `createAgent` option lets tests replace the real Claude Code subprocess
with a fake agent that simulates agent behavior.

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/agent-test.procedure.card", `---
name: agent-test
description: Test agent injection
steps:
  - id: agent-step
    description: An agent does work
    precheck:
      pass-output: true
      shells:
        - |
          echo "3 items to process"
    run:
      agents:
        - model: efficient
          prompt: Process the items listed in the precheck output.
---
`);
await box.write("box/output/.gitkeep", "");
box.commitAll("Add agent-test procedure");

// Fake agent: captures what it receives, writes a file, commits
let fakeAgent;
const mockCreateAgent = (opts) => {
  fakeAgent = createFakeAgent({
    name: opts.name,
    act: async ({ boxRoot }) => {
      await box.write("box/output/agent-result.txt", "processed 3 items");
      box.commitAll("Agent: process items");
      return { success: true, output: "Done" };
    },
  });
  return fakeAgent;
};

const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
const result = await startProcedure({
  ctx,
  procedureNameOrPath: "agent-test",
  options: { createAgent: mockCreateAgent },
});
print(`success: ${result.ok}`);

// Agent was called exactly once
print(`agent calls: ${fakeAgent.invocations.length}`);

// The system prompt includes the context block with precheck output
const systemPrompt = fakeAgent.invocations[0].systemPrompt;
print(`has precheck output: ${systemPrompt.includes("3 items to process")}`);
print(`has step ref: ${systemPrompt.includes("agent-step")}`);
print(`has agent instructions: ${systemPrompt.includes("Process the items")}`);

// Model was mapped from friendly name
print(`model: ${fakeAgent.invocations[0].options.model}`);

// Agent's file was preserved
const agentFile = await box.read("box/output/agent-result.txt");
print(`agent wrote: ${agentFile.trim()}`);
=>
success: true
agent calls: 1
has precheck output: true
has step ref: true
has agent instructions: true
model: claude-haiku-4-5-20251001
agent wrote: processed 3 items
```

```ts cleanup
await box.cleanup();
```

## The same portable tier resolves for a Codex box

Model resolution happens on the real procedure path before the injected agent
factory, so a recording fake proves the box engine affects the invocation—not
only an isolated mapping helper.

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/box.json", JSON.stringify({ agentEngine: "codex" }));
await box.write("config/procedures/codex-tier.procedure.card", `---
name: codex-tier
steps:
  - id: work
    run:
      agents:
        - model: efficient
          prompt: Do routine work.
---
`);
box.commitAll("Add codex procedure");

let fakeAgent;
const createAgent = (opts) => {
  fakeAgent = createFakeAgent({
    name: opts.name,
    act: async () => ({ success: true }),
  });
  return fakeAgent;
};
const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
const result = await startProcedure({
  ctx,
  procedureNameOrPath: "codex-tier",
  options: { createAgent },
});
print(`success: ${result.ok}`);
print(`model: ${fakeAgent.invocations[0].options.model}`);
=>
success: true
model: gpt-5.6-luna
```

```ts cleanup
await box.cleanup();
```

## Invocation rejection stays primary while finalizers still run

A native harness can reject a model or fail without a usable assistant
response. The procedure runs its declared shells (some are cleanup/finalizers),
then gates before validation and records the exact agent error.

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/rejected.procedure.card", `---
name: rejected
steps:
  - id: work
    run:
      agents:
        - model: balanced
          prompt: Do work.
      shells:
        - echo finalized > box/output/finalized.txt
    validate:
      severity: warn
      shells:
        - echo validated > box/output/validated.txt
---
`);
await box.write("box/output/.gitkeep", "");
box.commitAll("Add rejected procedure");

const createAgent = (opts) => createFakeAgent({
  name: opts.name,
  act: async () => ({
    success: false,
    error: "Model gpt-retired is not supported",
    invocationFailure: true,
  }),
});
const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
const result = await startProcedure({
  ctx,
  procedureNameOrPath: "rejected",
  options: { createAgent },
});
const runs = await box.list("procedure/runs");
const runDir = runs.split("\n").find((file) => file.includes("rejected_"));
const run = parseProcedureRun(await box.read(runDir + "/run.procedure-run.card"));
const outputFiles = await box.list("box/output");
print(`success: ${result.ok}`);
print(`error returned: ${result.ok ? "" : result.error.message}`);
print(`step: ${run.steps[0].status}`);
print(`error recorded: ${run.steps[0].run.error}`);
print(`finalizer ran: ${outputFiles.includes("finalized.txt")}`);
print(`validation ran: ${outputFiles.includes("validated.txt")}`);
=>
success: false
error returned: Procedure rejected failed at step: work — Agent invocation failed: Model gpt-retired is not supported
step: failed
error recorded: Model gpt-retired is not supported
finalizer ran: true
validation ran: false
```

```ts cleanup
await box.cleanup();
```

## Judge invocation rejection is not reduced to a validation symptom

Even a `warn` instruction check cannot claim a usable validation result when
the native judge harness rejected the invocation. The step fails with the
engine cause in both the validate record and the CLI result.

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/judge-rejected.procedure.card", `---
name: judge-rejected
steps:
  - id: work
    run:
      shells:
        - echo work complete
    validate:
      severity: warn
      instructions:
        - The work is complete.
---
`);
box.commitAll("Add judge-rejected procedure");

const createAgent = (opts) => createFakeAgent({
  name: opts.name,
  act: async () => ({ success: true }),
  structuredFailure: {
    error: "Model claude-retired is not supported",
    invocationFailure: true,
  },
});
const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
const result = await startProcedure({
  ctx,
  procedureNameOrPath: "judge-rejected",
  options: { createAgent },
});
const runs = await box.list("procedure/runs");
const runDir = runs.split("\n").find((file) => file.includes("judge-rejected_"));
const run = parseProcedureRun(await box.read(runDir + "/run.procedure-run.card"));
print(`success: ${result.ok}`);
print(`error returned: ${result.ok ? "" : result.error.message}`);
print(`step: ${run.steps[0].status}`);
print(`validation status: ${run.steps[0].validate.status}`);
print(`validation error: ${run.steps[0].validate.error}`);
=>
success: false
error returned: Procedure judge-rejected failed at step: work — Agent invocation failed: Model claude-retired is not supported
step: failed
validation status: warn
validation error: Model claude-retired is not supported
```

```ts cleanup
await box.cleanup();
```

## Directive passed to agent context

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/directed.procedure.card", `---
name: directed
description: Directive test
steps:
  - id: work
    description: Do work
    run:
      agents:
        - prompt: Follow the directive.
---
`);
box.commitAll("Add directed procedure");

let fakeAgent;
const mockCreateAgent = (opts) => {
  fakeAgent = createFakeAgent({
    name: opts.name,
    act: async () => ({ success: true }),
  });
  return fakeAgent;
};

const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
await startProcedure({
  ctx,
  procedureNameOrPath: "directed",
  options: { directive: "Focus on technical content", createAgent: mockCreateAgent },
});

const prompt = fakeAgent.invocations[0].systemPrompt;
print(`has directive: ${prompt.includes("<directive>")}`);
print(`directive text: ${prompt.includes("Focus on technical content")}`);
=>
has directive: true
directive text: true
```

```ts cleanup
await box.cleanup();
```

## Fallback commit for uncommitted agent changes

When an agent leaves uncommitted changes, the engine creates a
fallback commit to keep git clean between steps.

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/messy.procedure.card", `---
name: messy
description: Agent forgets to commit
steps:
  - id: forgetful
    description: Agent leaves uncommitted changes
    run:
      agents:
        - prompt: Do work but forget to commit.
---
`);
box.commitAll("Add messy procedure");

// Fake agent that writes a file but doesn't commit
const mockCreateAgent = (opts) => createFakeAgent({
  name: opts.name,
  act: async ({ boxRoot }) => {
    await box.write("box/output/uncommitted.txt", "forgot to commit this");
    // Deliberately NOT committing
    return { success: true };
  },
});

const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
const result = await startProcedure({
  ctx,
  procedureNameOrPath: "messy",
  options: { createAgent: mockCreateAgent },
});
print(`success: ${result.ok}`);

// The file is there — engine made a fallback commit
const content = await box.read("box/output/uncommitted.txt");
print(`file preserved: ${content.trim() === "forgot to commit this"}`);

// Git log shows a fallback commit
const log = execSync("git log --oneline", { cwd: box.root, encoding: "utf-8" });
print(`has fallback: ${log.includes("[procedure] forgetful:")}`);
=>
success: true
file preserved: true
has fallback: true
```

```ts cleanup
await box.cleanup();
```

## Agent then shell in one run phase (split is order-preserving)

A run phase with both an `agents:` and a `shells:` entry runs the agent first,
then the shell — the order the engine guarantees after `runRunPhase` was split
into `runRunAgents` + `runRunShells`.

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/mixed.procedure.card", `---
name: mixed
description: Agent and shell in one run phase
steps:
  - id: both
    description: Agent writes, then a shell appends
    run:
      agents:
        - prompt: Write the base file.
      shells:
        - |
          echo "shell-ran" > box/output/shell.txt
---
`);
await box.write("box/output/.gitkeep", "");
box.commitAll("Add mixed procedure");

let agentRan;
const createAgent = (opts) => createFakeAgent({
  name: opts.name,
  act: async () => {
    agentRan = true;
    await box.write("box/output/agent.txt", "agent-ran");
    box.commitAll("Agent: base file");
    return { success: true };
  },
});

const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
const result = await startProcedure({
  ctx,
  procedureNameOrPath: "mixed",
  options: { createAgent },
});
print(`success: ${result.ok}`);
print(`agent ran: ${agentRan}`);

const files = await box.list("box/output");
print(`agent.txt: ${files.includes("agent.txt")}`);
print(`shell.txt: ${files.includes("shell.txt")}`);
=>
success: true
agent ran: true
agent.txt: true
shell.txt: true
```

```ts cleanup
await box.cleanup();
```
