// # Procedure Engine: Agent Tests
//
// Tests for agent injection in the procedure engine — mock runners,
// directive passing, and fallback commits for uncommitted agent changes.

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
import assert from "node:assert/strict";
import type { AgentFactory } from "../../../src/core/procedure/engine-types.js";
import { startProcedure } from "../../../src/core/procedure/engine/core.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { createFakeAgent } from "../fake-agent.js";
import type { FakeAgent } from "../fake-agent.js";
import { modelTier, providerOf } from "../../../src/shared/agent-models.js";
import { execSync } from "node:child_process";
import { parseProcedureRun } from "../../../src/schemas/procedure-run.js";

const describeModel = (model: string | undefined) => {
  assert.ok(model !== undefined);
  return `${providerOf(model)} ${modelTier(model)}`;
};

// ## Agent step with mock runner
//
// The `createAgent` option lets tests replace the real Claude Code subprocess
// with a fake agent that simulates agent behavior.
void test("The createAgent option lets tests replace the real Claude Code subprocess wit...", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L36
  const box = await makeTmpBox({ git: true });
  await box.write("_config/procedures/agent-test.procedure.card", `---
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
  await box.write("_bookkeeping/output/.gitkeep", "");
  box.commitAll("Add agent-test procedure");

  // Fake agent: captures what it receives, writes a file, commits
  const fakeAgents: FakeAgent[] = [];
  const mockCreateAgent: AgentFactory = (opts) => {
    const agent = createFakeAgent({
      name: opts.name,
      act: async () => {
        await box.write("_bookkeeping/output/agent-result.txt", "processed 3 items");
        box.commitAll("Agent: process items");
        return { success: true, output: "Done" };
      },
    });
    fakeAgents.push(agent);
    return agent;
  };

  const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
  const result = await startProcedure({
    ctx,
    procedureNameOrPath: "agent-test",
    options: { createAgent: mockCreateAgent },
  });
  print(`success: ${result.ok}`);

  // Agent was called exactly once
  const fakeAgent = fakeAgents[0];
  assert.ok(fakeAgent);
  print(`agent calls: ${fakeAgent.invocations.length}`);

  // The system prompt includes the context block with precheck output
  const systemPrompt = fakeAgent.invocations[0]?.systemPrompt;
  assert.ok(systemPrompt);
  print(`has precheck output: ${systemPrompt.includes("3 items to process")}`);
  print(`has step ref: ${systemPrompt.includes("agent-step")}`);
  print(`has agent instructions: ${systemPrompt.includes("Process the items")}`);

  // Model was mapped from friendly name
  print(`model: ${describeModel(fakeAgent.invocations[0]?.options.model)}`);

  // Agent's file was preserved
  const agentFile = await box.read("_bookkeeping/output/agent-result.txt");
  // doctest:L57
  // doctest:L72
  // doctest:L80
  // doctest:L85
  // doctest:L92
  // doctest:L95
  await t.checkText(out.with(print(`agent wrote: ${agentFile.trim()}`)), `success: true
agent calls: 1
has precheck output: true
has step ref: true
has agent instructions: true
model: anthropic efficient
agent wrote: processed 3 items`);
});

// ## The same portable tier resolves for a Codex box
//
// Model resolution happens on the real procedure path before the injected agent
// factory, so a recording fake proves the box engine affects the invocation—not
// only an isolated mapping helper.
void test("Model resolution happens on the real procedure path before the injected agent...", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L119
  const box = await makeTmpBox({ git: true });
  await box.write("_config/box.json", JSON.stringify({ agentEngine: "codex" }));
  await box.write("_config/procedures/codex-tier.procedure.card", `---
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

  const fakeAgents: FakeAgent[] = [];
  const createAgent: AgentFactory = (opts) => {
    const agent = createFakeAgent({
      name: opts.name,
      act: async () => ({ success: true }),
    });
    fakeAgents.push(agent);
    return agent;
  };
  const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
  const result = await startProcedure({
    ctx,
    procedureNameOrPath: "codex-tier",
    options: { createAgent },
  });
  print(`success: ${result.ok}`);
  const fakeAgent = fakeAgents[0];
  assert.ok(fakeAgent);
  // doctest:L133
  await t.checkText(out.with(print(`model: ${describeModel(fakeAgent.invocations[0]?.options.model)}`)), `success: true
model: openai efficient`);
});

// ## An OpenRouter default carries every agent step
//
// An added OpenRouter model has no tier, so the box's two slots stand in: the
// small model takes `efficient`, the default takes `strong`, and a step that
// names no model takes the default too. None of them needs a Claude login.
void test("An added OpenRouter model has no tier, so the box's two slots stand in:", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L168
  const box = await makeTmpBox({ git: true });
  await box.write("_config/box.json", JSON.stringify({
    agentModel: "moonshotai/kimi-k2-0905:exacto",
    smallModel: "deepseek/deepseek-v3.2",
    openrouterModels: [
      { id: "moonshotai/kimi-k2-0905:exacto", label: "Kimi K2" },
      { id: "deepseek/deepseek-v3.2", label: "DeepSeek" },
    ],
  }));
  await box.write("_config/procedures/openrouter-tiers.procedure.card", `---
name: openrouter-tiers
steps:
  - id: work
    run:
      agents:
        - model: strong
          prompt: Do hard work.
        - model: efficient
          prompt: Do routine work.
        - prompt: Do unlabelled work.
---
`);
  box.commitAll("Add openrouter procedure");

  const models: string[] = [];
  const createAgent: AgentFactory = (opts) => {
    const agent = createFakeAgent({ name: opts.name, act: async () => ({ success: true }) });
    const invoke = agent.invoke.bind(agent);
    agent.invoke = async (options) => { if (options.model !== undefined) models.push(options.model); return invoke(options); };
    return agent;
  };
  const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
  const result = await startProcedure({ ctx, procedureNameOrPath: "openrouter-tiers", options: { createAgent } });
  print(`success: ${result.ok}`);
  // doctest:L192
  await t.checkText(out.with(print(models.join("\n"))), `success: true
moonshotai/kimi-k2-0905:exacto
deepseek/deepseek-v3.2
moonshotai/kimi-k2-0905:exacto`);
});

// ## Invocation rejection stays primary while finalizers still run
//
// A native harness can reject a model or fail without a usable assistant
// response. The procedure runs its declared shells (some are cleanup/finalizers),
// then gates before validation and records the exact agent error.
void test("A native harness can reject a model or fail without a usable assistant response.", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L221
  const box = await makeTmpBox({ git: true });
  await box.write("_config/procedures/rejected.procedure.card", `---
name: rejected
steps:
  - id: work
    run:
      agents:
        - model: balanced
          prompt: Do work.
      shells:
        - echo finalized > _bookkeeping/output/finalized.txt
    validate:
      severity: warn
      shells:
        - echo validated > _bookkeeping/output/validated.txt
---
`);
  await box.write("_bookkeeping/output/.gitkeep", "");
  box.commitAll("Add rejected procedure");

  const createAgent: AgentFactory = (opts) => createFakeAgent({
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
  const runs = await box.list("_bookkeeping/procedure/runs");
  const runDir = runs.split("\n").find((file) => file.includes("rejected_"));
  const run = parseProcedureRun(await box.read(runDir + "/run.procedure-run.card"));
  const outputFiles = await box.list("_bookkeeping/output");
  print(`success: ${result.ok}`);
  print(`error returned: ${result.ok ? "" : result.error.message}`);
  print(`step: ${run?.steps[0]?.status}`);
  print(`error recorded: ${run?.steps[0]?.run?.error}`);
  print(`finalizer ran: ${outputFiles.includes("finalized.txt")}`);
  // doctest:L241
  await t.checkText(out.with(print(`validation ran: ${outputFiles.includes("validated.txt")}`)), `success: false
error returned: Procedure rejected failed at step: work — Agent invocation failed: Model gpt-retired is not supported
step: failed
error recorded: Model gpt-retired is not supported
finalizer ran: true
validation ran: false`);
});

// ## Judge invocation rejection is not reduced to a validation symptom
//
// Even a `warn` instruction check cannot claim a usable validation result when
// the native judge harness rejected the invocation. The step fails with the
// engine cause in both the validate record and the CLI result.
void test("Even a warn instruction check cannot claim a usable validation result when th...", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L285
  const box = await makeTmpBox({ git: true });
  await box.write("_config/procedures/judge-rejected.procedure.card", `---
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

  const createAgent: AgentFactory = (opts) => createFakeAgent({
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
  const runs = await box.list("_bookkeeping/procedure/runs");
  const runDir = runs.split("\n").find((file) => file.includes("judge-rejected_"));
  const run = parseProcedureRun(await box.read(runDir + "/run.procedure-run.card"));
  print(`success: ${result.ok}`);
  print(`error returned: ${result.ok ? "" : result.error.message}`);
  print(`step: ${run?.steps[0]?.status}`);
  print(`validation status: ${run?.steps[0]?.validate?.status}`);
  // doctest:L301
  await t.checkText(out.with(print(`validation error: ${run?.steps[0]?.validate?.error}`)), `success: false
error returned: Procedure judge-rejected failed at step: work — Agent invocation failed: Model claude-retired is not supported
step: failed
validation status: warn
validation error: Model claude-retired is not supported`);
});

// ## Directive passed to agent context
void test("Directive passed to agent context", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L338
  const box = await makeTmpBox({ git: true });
  await box.write("_config/procedures/directed.procedure.card", `---
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

  const fakeAgents: FakeAgent[] = [];
  const mockCreateAgent: AgentFactory = (opts) => {
    const agent = createFakeAgent({
      name: opts.name,
      act: async () => ({ success: true }),
    });
    fakeAgents.push(agent);
    return agent;
  };

  const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
  await startProcedure({
    ctx,
    procedureNameOrPath: "directed",
    options: { directive: "Focus on technical content", createAgent: mockCreateAgent },
  });

  const fakeAgent = fakeAgents[0];
  assert.ok(fakeAgent);
  const prompt = fakeAgent.invocations[0]?.systemPrompt;
  assert.ok(prompt);
  print(`has directive: ${prompt.includes("<directive>")}`);
  // doctest:L352
  // doctest:L362
  // doctest:L369
  await t.checkText(out.with(print(`directive text: ${prompt.includes("Focus on technical content")}`)), `has directive: true
directive text: true`);
});

// ## Fallback commit for uncommitted agent changes
//
// When an agent leaves uncommitted changes, the engine creates a
// fallback commit to keep git clean between steps.
void test("When an agent leaves uncommitted changes, the engine creates a fallback commi...", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L390
  const box = await makeTmpBox({ git: true });
  await box.write("_config/procedures/messy.procedure.card", `---
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
  const mockCreateAgent: AgentFactory = (opts) => createFakeAgent({
    name: opts.name,
    act: async () => {
      await box.write("_bookkeeping/output/uncommitted.txt", "forgot to commit this");
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
  const content = await box.read("_bookkeeping/output/uncommitted.txt");
  print(`file preserved: ${content.trim() === "forgot to commit this"}`);

  // Git log shows a fallback commit
  const log = execSync("git log --oneline", { cwd: box.root, encoding: "utf-8" });
  // doctest:L404
  // doctest:L414
  // doctest:L422
  // doctest:L426
  await t.checkText(out.with(print(`has fallback: ${log.includes("[procedure] forgetful:")}`)), `success: true
file preserved: true
has fallback: true`);
});

// ## Agent then shell in one run phase (split is order-preserving)
//
// A run phase with both an `agents:` and a `shells:` entry runs the agent first,
// then the shell — the order the engine guarantees after `runRunPhase` was split
// into `runRunAgents` + `runRunShells`. The shell reads the file the agent wrote,
// so its output shows the agent ran first.
void test("A run phase with both an agents: and a shells: entry runs the agent first, th...", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L447
  const box = await makeTmpBox({ git: true });
  await box.write("_config/procedures/mixed.procedure.card", `---
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
          cat _bookkeeping/output/agent.txt > _bookkeeping/output/shell.txt
          echo " then shell-ran" >> _bookkeeping/output/shell.txt
---
`);
  await box.write("_bookkeeping/output/.gitkeep", "");
  box.commitAll("Add mixed procedure");

  let agentRan;
  const createAgent: AgentFactory = (opts) => createFakeAgent({
    name: opts.name,
    act: async () => {
      agentRan = true;
      await box.write("_bookkeeping/output/agent.txt", "agent-ran");
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

  const files = await box.list("_bookkeeping/output");
  print(`agent.txt: ${files.includes("agent.txt")}`);
  // doctest:L466
  // doctest:L477
  // doctest:L486
  await t.checkText(out.with(print(`shell.txt: ${(await box.read("_bookkeeping/output/shell.txt")).replace(/\s+/g, " ").trim()}`)), `success: true
agent ran: true
agent.txt: true
shell.txt: agent-ran then shell-ran`);
});
