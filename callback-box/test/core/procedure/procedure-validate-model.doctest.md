# Procedure Engine: Model-Evaluated Instruction Validation

Tests for `evaluateInstructions` — the review-model judge that decides whether a
step's git diff satisfies its `instructions:`. The model is faked via the
`createAgent` factory seam (`structuredResult` returns a scripted verdict), so
no live model is hit.

Three outcomes, deliberately distinct: a `verdict` (the judge decided), an
`inconclusive` non-answer (it ran out of turns / timed out / returned nothing
parseable), and an `invocation-failure` (the harness never produced an
assistant response at all).

```ts setup
import { evaluateInstructions } from "../../../src/core/procedure/engine-validate-model.js";
import { createFakeAgent } from "../../helpers/fake-agent.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
```

## A passing verdict

The model judges the diff satisfies the instruction → `passed: true`, and the
reasoning is surfaced as the `review` string.

```ts
let captured;
const createAgent = (opts) => createFakeAgent({
  name: opts.name,
  act: async () => ({ success: true }),
  structuredResult: ({ systemPrompt }) => {
    captured = systemPrompt;
    return { passed: true, reasoning: "The diff adds the transcription block." };
  },
});

const result = await evaluateInstructions({
  boxRoot: "/tmp/box",
  instructions: ["Every audio clip has a transcription block."],
  whys: ["Clips without transcripts can't be searched."],
  diff: "+ transcription: hello world",
  createAgent,
  name: "judge",
});
print(`outcome: ${result.outcome}`);
print(`passed: ${result.passed}`);
print(`review: ${result.review}`);

// The judge prompt carries the instruction, why, and diff.
print(`prompt has instruction: ${captured.includes("Every audio clip")}`);
print(`prompt has why: ${captured.includes("can't be searched")}`);
print(`prompt has diff: ${captured.includes("hello world")}`);
=>
outcome: verdict
passed: true
review: The diff adds the transcription block.
prompt has instruction: true
prompt has why: true
prompt has diff: true
```

## A failing verdict

```ts
const createAgent = (opts) => createFakeAgent({
  name: opts.name,
  act: async () => ({ success: true }),
  structuredResult: () => ({ passed: false, reasoning: "No transcription block in the diff." }),
});

const result = await evaluateInstructions({
  boxRoot: "/tmp/box",
  instructions: ["Every audio clip has a transcription block."],
  whys: [],
  diff: "+ unrelated change",
  createAgent,
  name: "judge",
});
print(`outcome: ${result.outcome}`);
print(`passed: ${result.passed}`);
print(`review: ${result.review}`);
=>
outcome: verdict
passed: false
review: No transcription block in the diff.
```

## No verdict is inconclusive — never a failing verdict

When the judge hits its turn cap, the check has produced a **non-answer**. It is
reported as `inconclusive` with the budget reason, not as `passed: false` — a
checker that ran out of budget has found nothing wrong, and saying it did is
what taught readers to discount the signal.

The judge is retried once (a fresh session at double the turn cap: a resumed
one would inherit whatever wandering ate the first budget). The *work* agent is
never retried — its work is already done and committed.

```ts
const turnCaps = [];
const createAgent = (opts) => createFakeAgent({
  name: opts.name,
  act: async () => ({ success: true }),
  structuredResult: () => null,
  structuredFailure: { error: "error_max_turns" },
});

const result = await evaluateInstructions({
  boxRoot: "/tmp/box",
  instructions: ["Every audio clip has a transcription block."],
  whys: [],
  diff: "+ something",
  createAgent: (opts) => {
    const agent = createAgent(opts);
    const invokeStructured = agent.invokeStructured;
    agent.invokeStructured = (schema, options) => {
      turnCaps.push(options.maxTurns);
      return invokeStructured(schema, options);
    };
    return agent;
  },
  name: "judge",
});
print(`outcome: ${result.outcome}`);
print(`reason: ${result.reason}`);
print(`detail: ${result.detail}`);
print(`review: ${result.review}`);
print(`turn caps: ${turnCaps.join(", ")}`);
=>
outcome: inconclusive
reason: max-turns
detail: reached max turns (16)
review: Instruction validation was inconclusive: the review reached max turns (16). The work was not judged — it is neither approved nor rejected.
turn caps: 8, 16
```

Unparseable output is inconclusive too, under its own reason — a different
problem (the model answered, just not in the shape asked for) with a different
fix:

```ts
const createAgent = (opts) => createFakeAgent({
  name: opts.name,
  act: async () => ({ success: true }),
  structuredResult: () => null,
  // The literal `validateStructuredResult` emits when the model answered but
  // no JSON came back.
  structuredFailure: { error: "Structured output: no JSON found in result" },
});

const result = await evaluateInstructions({
  boxRoot: "/tmp/box",
  instructions: ["Every audio clip has a transcription block."],
  whys: [],
  diff: "+ something",
  createAgent,
  name: "judge",
});
print(`outcome: ${result.outcome}`);
print(`reason: ${result.reason}`);
print(`detail: ${result.detail}`);
=>
outcome: inconclusive
reason: no-structured-output
detail: returned no parseable verdict
```

## A harness that never answered still gates

An `invocationFailure` is not an inconclusive verdict — validation did not run
at all (auth/model rejection, transport). It keeps gating the step, and it is
not retried.

```ts
let attempts = 0;
const createAgent = (opts) => {
  attempts++;
  return createFakeAgent({
    name: opts.name,
    act: async () => ({ success: true }),
    structuredResult: () => null,
    structuredFailure: { error: "No conversation found", invocationFailure: true },
  });
};

const result = await evaluateInstructions({
  boxRoot: "/tmp/box",
  instructions: ["Every audio clip has a transcription block."],
  whys: [],
  diff: "+ something",
  createAgent,
  name: "judge",
});
print(`outcome: ${result.outcome}`);
print(`error: ${result.error}`);
print(`judge attempts: ${attempts}`);
=>
outcome: invocation-failure
error: No conversation found
judge attempts: 1
```

## Default judge tier follows the box engine

An unpinned instruction judge must not inherit a Claude-only default on a Codex
box.

```ts
const box = await makeTmpBox({ git: true });
await box.write("config/box.json", JSON.stringify({ agentEngine: "codex" }));
box.commitAll("Configure Codex");

let fakeAgent;
const createAgent = (opts) => {
  fakeAgent = createFakeAgent({
    name: opts.name,
    act: async () => ({ success: true }),
    structuredResult: () => ({ passed: true, reasoning: "Looks good." }),
  });
  return fakeAgent;
};

await evaluateInstructions({
  boxRoot: box.root,
  instructions: ["The change is complete."],
  whys: [],
  diff: "+ complete",
  createAgent,
  name: "judge",
});
fakeAgent.invocations[0].options.model
=> gpt-5.6-terra
```

```ts cleanup
await box.cleanup();
```
