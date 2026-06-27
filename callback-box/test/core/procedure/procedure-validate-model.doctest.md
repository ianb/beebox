# Procedure Engine: Model-Evaluated Instruction Validation

Tests for `evaluateInstructions` — the review-model judge that decides whether a
step's git diff satisfies its `instructions:`. The model is faked via the
`createAgent` factory seam (`structuredResult` returns a scripted verdict), so
no live model is hit.

```ts setup
import { evaluateInstructions } from "../../../src/core/procedure/engine-validate-model.js";
import { createFakeAgent } from "../../helpers/fake-agent.js";
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
print(`passed: ${result.passed}`);
print(`review: ${result.review}`);

// The judge prompt carries the instruction, why, and diff.
print(`prompt has instruction: ${captured.includes("Every audio clip")}`);
print(`prompt has why: ${captured.includes("can't be searched")}`);
print(`prompt has diff: ${captured.includes("hello world")}`);
=>
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
print(`passed: ${result.passed}`);
print(`review: ${result.review}`);
=>
passed: false
review: No transcription block in the diff.
```

## Model-unavailable is fail-closed

When the model call returns no parseable verdict (`structuredResult` returns
`null`), the check fails closed — it never silently passes — and the error is
recorded as the reasoning.

```ts
const createAgent = (opts) => createFakeAgent({
  name: opts.name,
  act: async () => ({ success: true }),
  structuredResult: () => null,
});

const result = await evaluateInstructions({
  boxRoot: "/tmp/box",
  instructions: ["Every audio clip has a transcription block."],
  whys: [],
  diff: "+ something",
  createAgent,
  name: "judge",
});
print(`passed: ${result.passed}`);
print(`review mentions failure: ${result.review.includes("could not obtain a verdict")}`);
=>
passed: false
review mentions failure: true
```
