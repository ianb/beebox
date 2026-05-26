# Procedure Engine: Agent Tests

Tests for agent injection in the procedure engine — mock runners,
directive passing, and fallback commits for uncommitted agent changes.

```ts setup
import { startProcedure } from "../src/core/procedure/engine.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import { createFakeAgent } from "./helpers/fake-agent.js";
import { execSync } from "node:child_process";
```

## Agent step with mock runner

The `createAgent` option lets tests replace the real Claude Code subprocess
with a fake agent that simulates agent behavior.

```
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/agent-test.procedure.card", `
<procedure name="agent-test">
  <description>Test agent injection</description>
  <step id="agent-step">
    <description>An agent does work</description>
    <precheck pass-output="true">
      <shell>echo "3 items to process"</shell>
    </precheck>
    <run>
      <agent model="haiku">Process the items listed in the precheck output.</agent>
    </run>
  </step>
</procedure>
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
print(`success: ${result.success}`);

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

``` cleanup
await box.cleanup();
```

## Directive passed to agent context

```
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/directed.procedure.card", `
<procedure name="directed">
  <description>Directive test</description>
  <step id="work">
    <description>Do work</description>
    <run>
      <agent>Follow the directive.</agent>
    </run>
  </step>
</procedure>
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

``` cleanup
await box.cleanup();
```

## Fallback commit for uncommitted agent changes

When an agent leaves uncommitted changes, the engine creates a
fallback commit to keep git clean between steps.

```
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/messy.procedure.card", `
<procedure name="messy">
  <description>Agent forgets to commit</description>
  <step id="forgetful">
    <description>Agent leaves uncommitted changes</description>
    <run>
      <agent>Do work but forget to commit.</agent>
    </run>
  </step>
</procedure>
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
print(`success: ${result.success}`);

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

``` cleanup
await box.cleanup();
```
