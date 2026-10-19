// # Procedure Engine: Agent Tests
//
// Tests for agent injection in the procedure engine — mock runners,
// directive passing, and fallback commits for uncommitted agent changes.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate } from "@ianbicking/tap-check/check";
import assert from "node:assert/strict";
import type { AgentFactory } from "../../../src/core/procedure/engine-types.js";
import { startProcedure } from "../../../src/core/procedure/engine/core.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
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
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
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
  // Agent was called exactly once
  const fakeAgent = fakeAgents[0];
  assert.ok(fakeAgent);

  // Model was mapped from friendly name; the agent's file was preserved
  t.check(
    { result, agentCalls: fakeAgent.invocations.length, model: describeModel(fakeAgent.invocations[0]?.options.model), agentWrote: (await box.read("_bookkeeping/output/agent-result.txt")).trim() },
    { result: {
      ok: true,
      value: { status: "completed", procedure: "agent-test", inconclusive: [] },
    }, agentCalls: 1, model: "anthropic efficient", agentWrote: "processed 3 items" },
  );

  // The system prompt (a large generated text) includes the context block with precheck output
  const systemPrompt = fakeAgent.invocations[0]?.systemPrompt;
  assert.ok(systemPrompt);
  t.check(systemPrompt, any(String).includes("3 items to process"));
  t.check(systemPrompt, any(String).includes("agent-step"));
  t.check(systemPrompt, any(String).includes("Process the items"));
});

// ## The same portable tier resolves for a Codex box
//
// Model resolution happens on the real procedure path before the injected agent
// factory, so a recording fake proves the box engine affects the invocation—not
// only an isolated mapping helper.
void test("Model resolution happens on the real procedure path before the injected agent...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
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
  const fakeAgent = fakeAgents[0];
  assert.ok(fakeAgent);
  t.check({ result, model: describeModel(fakeAgent.invocations[0]?.options.model) }, {
    result: {
      ok: true,
      value: { status: "completed", procedure: "codex-tier", inconclusive: [] },
    },
    model: "openai efficient",
  });
});

// ## An OpenRouter default carries every agent step
//
// An added OpenRouter model has no tier, so the box's two slots stand in: the
// small model takes `efficient`, the default takes `strong`, and a step that
// names no model takes the default too. None of them needs a Claude login.
void test("An added OpenRouter model has no tier, so the box's two slots stand in:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
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
  t.check({ result, models }, {
    result: {
      ok: true,
      value: { status: "completed", procedure: "openrouter-tiers", inconclusive: [] },
    },
    models: ["moonshotai/kimi-k2-0905:exacto", "deepseek/deepseek-v3.2", "moonshotai/kimi-k2-0905:exacto"],
  });
});

// ## Invocation rejection stays primary while finalizers still run
//
// A native harness can reject a model or fail without a usable assistant
// response. The procedure runs its declared shells (some are cleanup/finalizers),
// then gates before validation and records the exact agent error.
void test("A native harness can reject a model or fail without a usable assistant response.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
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
  // The session id and git ref are minted per run.
  t.check({ result, step: run?.steps[0], outputFiles }, {
    result: {
      ok: false,
      error: {
        cause: "step-failed",
        message: "Procedure rejected failed at step: work — Agent invocation failed: Model gpt-retired is not supported",
      },
    },
    step: {
      id: "work",
      status: "failed",
      "started-at": isoDate(),
      "completed-at": isoDate(),
      run: {
        "session-id": any(String).startsWith("fake-"),
        error: "Model gpt-retired is not supported",
        "git-ref": any(String).matches(/^[\da-f]{40}$/),
      },
    },
    outputFiles: `_bookkeeping/output/.gitkeep
_bookkeeping/output/finalized.txt`,
  });
});

// ## Judge invocation rejection is not reduced to a validation symptom
//
// Even a `warn` instruction check cannot claim a usable validation result when
// the native judge harness rejected the invocation. The step fails with the
// engine cause in both the validate record and the CLI result.
void test("Even a warn instruction check cannot claim a usable validation result when th...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
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
  t.check({ result, step: run?.steps[0] }, {
    result: {
      ok: false,
      error: {
        cause: "step-failed",
        message: "Procedure judge-rejected failed at step: work — Agent invocation failed: Model claude-retired is not supported",
      },
    },
    step: {
      id: "work",
      status: "failed",
      "started-at": isoDate(),
      "completed-at": isoDate(),
      run: { stdout: "work complete", "git-ref": any(String).matches(/^[\da-f]{40}$/) },
      validate: {
        status: "warn",
        review: "Instruction validation could not run: Model claude-retired is not supported",
        error: "Model claude-retired is not supported",
      },
    },
  });
});

// ## Directive passed to agent context
void test("Directive passed to agent context", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
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
  // The system prompt is a large generated text; check for the directive block and its text.
  t.check(prompt, any(String).includes("<directive>"));
  t.check(prompt, any(String).includes("Focus on technical content"));
});

// ## Fallback commit for uncommitted agent changes
//
// When an agent leaves uncommitted changes, the engine creates a
// fallback commit to keep git clean between steps.
void test("When an agent leaves uncommitted changes, the engine creates a fallback commi...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
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
  // The file is there — engine made a fallback commit
  const content = await box.read("_bookkeeping/output/uncommitted.txt");
  t.check({ result, content }, { result: {
      ok: true,
      value: { status: "completed", procedure: "messy", inconclusive: [] },
    }, content: "forgot to commit this" });

  // Git log shows a fallback commit
  const log = execSync("git log --oneline", { cwd: box.root, encoding: "utf-8" });
  await t.checkText(log, `«*» Complete procedure: messy
«*» [procedure] Complete step: forgetful
«*» [procedure] forgetful: update uncommitted.txt
«*» Start procedure: messy
«*» Add messy procedure
«*» init`);
});

// ## Agent then shell in one run phase (split is order-preserving)
//
// A run phase with both an `agents:` and a `shells:` entry runs the agent first,
// then the shell — the order the engine guarantees after `runRunPhase` was split
// into `runRunAgents` + `runRunShells`. The shell reads the file the agent wrote,
// so its output shows the agent ran first.
void test("A run phase with both an agents: and a shells: entry runs the agent first, th...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
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

  let agentRan = false;
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
  t.check(
    { result, agentRan, files: await box.list("_bookkeeping/output"), shell: (await box.read("_bookkeeping/output/shell.txt")).replace(/\s+/g, " ").trim() },
    {
      result: {
      ok: true,
      value: { status: "completed", procedure: "mixed", inconclusive: [] },
    },
      agentRan: true,
      files: `_bookkeeping/output/.gitkeep
_bookkeeping/output/agent.txt
_bookkeeping/output/shell.txt`,
      shell: "agent-ran then shell-ran",
    },
  );
});
