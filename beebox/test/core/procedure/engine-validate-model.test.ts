// # Procedure Engine: Model-Evaluated Instruction Validation
//
// Tests for `evaluateInstructions` — the review-model judge that decides whether a
// step's git diff satisfies its `instructions:`. The model is faked via the
// `createAgent` factory seam (`structuredResult` returns a scripted verdict), so
// no live model is hit.
//
// Three outcomes, deliberately distinct: a `verdict` (the judge decided), an
// `inconclusive` non-answer (it ran out of turns / timed out / returned nothing
// parseable), and an `invocation-failure` (the harness never produced an
// assistant response at all).

import { test } from "tap";
import "agent-doctest/tap";
import { any } from "agent-doctest/check";
import assert from "node:assert/strict";
import type { AgentFactory } from "../../../src/core/procedure/engine-types.js";
import { evaluateInstructions } from "../../../src/core/procedure/engine-validate-model.js";
import { createFakeAgent } from "../fake-agent.js";
import type { FakeAgent } from "../fake-agent.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { modelTier, providerOf } from "../../../src/shared/agent-models.js";

// ## A passing verdict
//
// The model judges the diff satisfies the instruction → `passed: true`, and the
// reasoning is surfaced as the `review` string.
void test("The model judges the diff satisfies the instruction → passed:", async (t) => {
  // doctest:L45
  let captured = "";
  const createAgent: AgentFactory = (opts) => createFakeAgent({
    name: opts.name,
    act: async () => ({ success: true }),
    structuredResult: ({ systemPrompt }) => {
      captured = systemPrompt ?? "";
      return { passed: true, reasoning: "The diff adds the transcription block." };
    },
  });

  // doctest:L55
  const result = await evaluateInstructions({
    boxRoot: "/tmp/box",
    instructions: ["Every audio clip has a transcription block."],
    whys: ["Clips without transcripts can't be searched."],
    diff: "+ transcription: hello world",
    createAgent,
    name: "judge",
  });
  t.check(result, { outcome: "verdict", passed: true, review: "The diff adds the transcription block." });

  // doctest:L68
  // The judge prompt is a large generated text; the check is that it carries the
  // instruction, the why, and the diff.
  t.check(captured, any(String).includes("Every audio clip"));
  t.check(captured, any(String).includes("can't be searched"));
  t.check(captured, any(String).includes("hello world"));
});

// ## A failing verdict
void test("A failing verdict", async (t) => {
  // doctest:L84
  const createAgent: AgentFactory = (opts) => createFakeAgent({
    name: opts.name,
    act: async () => ({ success: true }),
    structuredResult: () => ({ passed: false, reasoning: "No transcription block in the diff." }),
  });

  // doctest:L90
  const result = await evaluateInstructions({
    boxRoot: "/tmp/box",
    instructions: ["Every audio clip has a transcription block."],
    whys: [],
    diff: "+ unrelated change",
    createAgent,
    name: "judge",
  });
  t.check(result, { outcome: "verdict", passed: false, review: "No transcription block in the diff." });
});

// ## No verdict is inconclusive — never a failing verdict
//
// When the judge hits its turn cap, the check has produced a **non-answer**. It is
// reported as `inconclusive` with the budget reason, not as `passed: false` — a
// checker that ran out of budget has found nothing wrong, and saying it did is
// what taught readers to discount the signal.
//
// The judge is retried once (a fresh session at double the turn cap: a resumed
// one would inherit whatever wandering ate the first budget). The *work* agent is
// never retried — its work is already done and committed.
void test("When the judge hits its turn cap, the check has produced a non-answer.", async (t) => {
  // doctest:L120
  const turnCaps: number[] = [];
  const createAgent: AgentFactory = (opts) => createFakeAgent({
    name: opts.name,
    act: async () => ({ success: true }),
    structuredResult: () => null,
    structuredFailure: { error: "error_max_turns" },
  });

  // doctest:L128
  const result = await evaluateInstructions({
    boxRoot: "/tmp/box",
    instructions: ["Every audio clip has a transcription block."],
    whys: [],
    diff: "+ something",
    createAgent: (opts) => {
      const agent = createAgent(opts);
      const invokeStructured = agent.invokeStructured;
      agent.invokeStructured = (schema, options) => {
        if (options.maxTurns !== undefined) turnCaps.push(options.maxTurns);
        return invokeStructured(schema, options);
      };
      return agent;
    },
    name: "judge",
  });
  t.check({ result, turnCaps }, {
    result: {
      outcome: "inconclusive",
      reason: "max-turns",
      detail: "reached max turns (16)",
      review: "Instruction validation was inconclusive: the review reached max turns (16). The work was not judged — it is neither approved nor rejected.",
    },
    turnCaps: [8, 16],
  });
});

// Unparseable output is inconclusive too, under its own reason — a different
// problem (the model answered, just not in the shape asked for) with a different
// fix:
void test("Unparseable output is inconclusive too, under its own reason — a different pr...", async (t) => {
  // doctest:L163
  const createAgent: AgentFactory = (opts) => createFakeAgent({
    name: opts.name,
    act: async () => ({ success: true }),
    structuredResult: () => null,
    // The literal `validateStructuredResult` emits when the model answered but
    // no JSON came back.
    structuredFailure: { error: "Structured output: no JSON found in result" },
  });

  // doctest:L172
  const result = await evaluateInstructions({
    boxRoot: "/tmp/box",
    instructions: ["Every audio clip has a transcription block."],
    whys: [],
    diff: "+ something",
    createAgent,
    name: "judge",
  });
  t.check(result, {
    outcome: "inconclusive",
    reason: "no-structured-output",
    detail: "returned no parseable verdict",
    review: "Instruction validation was inconclusive: the review returned no parseable verdict. The work was not judged — it is neither approved nor rejected.",
  });
});

// ## A harness that never answered still gates
//
// An `invocationFailure` is not an inconclusive verdict — validation did not run
// at all (auth/model rejection, transport). It keeps gating the step, and it is
// not retried.
void test("An invocationFailure is not an inconclusive verdict — validation did not run...", async (t) => {
  // doctest:L197
  let attempts = 0;
  const createAgent: AgentFactory = (opts) => {
    attempts++;
    return createFakeAgent({
      name: opts.name,
      act: async () => ({ success: true }),
      structuredResult: () => null,
      structuredFailure: { error: "No conversation found", invocationFailure: true },
    });
  };

  // doctest:L208
  const result = await evaluateInstructions({
    boxRoot: "/tmp/box",
    instructions: ["Every audio clip has a transcription block."],
    whys: [],
    diff: "+ something",
    createAgent,
    name: "judge",
  });
  t.check({ result, attempts }, {
    result: {
      outcome: "invocation-failure",
      review: "Instruction validation could not run: No conversation found",
      error: "No conversation found",
    },
    attempts: 1,
  });
});

// ## Default judge tier follows the box engine
//
// An unpinned instruction judge must not inherit a Claude-only default on a Codex
// box.
void test("An unpinned instruction judge must not inherit a Claude-only default on a Cod...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L232
  const box = await makeTmpBox({ git: true });
  await box.write("_config/box.json", JSON.stringify({ agentEngine: "codex" }));
  box.commitAll("Configure Codex");

  // doctest:L236
  const fakeAgents: FakeAgent[] = [];
  const createAgent: AgentFactory = (opts) => {
    const agent = createFakeAgent({
      name: opts.name,
      act: async () => ({ success: true }),
      structuredResult: () => ({ passed: true, reasoning: "Looks good." }),
    });
    fakeAgents.push(agent);
    return agent;
  };

  // doctest:L247
  await evaluateInstructions({
    boxRoot: box.root,
    instructions: ["The change is complete."],
    whys: [],
    diff: "+ complete",
    createAgent,
    name: "judge",
  });
  const fakeAgent = fakeAgents[0];
  assert.ok(fakeAgent);
  const judgeModel = fakeAgent.invocations[0]?.options.model;
  assert.ok(judgeModel !== undefined);
  t.check([providerOf(judgeModel), modelTier(judgeModel)], [
    "openai",
    "balanced",
  ]);
});
