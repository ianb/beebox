# Question card schema

Question cards ask the user something and route the answer back for
processing. An answer has two products: the immediate effect (`directive:`)
and, optionally, durable knowledge the answer teaches (`learning:` — see
`docs/implemented-plans/questions-end-to-end.md`). This covers the `input` cross-field
refinement, the lifecycle state, the learning/expiry vocabulary, and the three template
builders. Round-trip answer behavior lives in
`test/core/commands/answer.doctest.md`.

```ts setup
import {
  QuestionSchema,
  questionState,
  createSelectQuestionTemplate,
  createTextQuestionTemplate,
  createConfirmQuestionTemplate,
} from "../../src/schemas/question.js";

const ASKED_AT = "2026-07-10T09:00:00-07:00";

function baseFields(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "question",
    prompt: "What color?",
    input: { type: "text" },
    ...overrides,
  };
}
```

## `input` refinement: select requires at least two options

```ts
QuestionSchema.frontmatterSchema.safeParse(baseFields({ input: { type: "select" } })).success
=> false

QuestionSchema.frontmatterSchema.safeParse(
  baseFields({ input: { type: "select", options: [{ id: "a", label: "A" }] } })
).success
=> false

QuestionSchema.frontmatterSchema.safeParse(
  baseFields({
    input: { type: "select", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] },
  })
).success
=> true
```

## `input` refinement: confirm and text must not carry options

```ts
QuestionSchema.frontmatterSchema.safeParse(
  baseFields({ input: { type: "confirm", options: [{ id: "yes", label: "Yes" }] } })
).success
=> false

QuestionSchema.frontmatterSchema.safeParse(
  baseFields({ input: { type: "text", options: [{ id: "a", label: "A" }] } })
).success
=> false

QuestionSchema.frontmatterSchema.safeParse(baseFields({ input: { type: "confirm" } })).success
=> true
```

## State: read from which lifecycle timestamp the card carries

`questionState` is the one place a question's state is derived. It also takes
loose frontmatter, which the nav count reads without a full load.

```ts
[
  baseFields(),
  baseFields({ answer: { text: "Blue" }, "answered-at": ASKED_AT }),
  baseFields({ "dismissed-at": ASKED_AT }),
  baseFields({ "expired-at": ASKED_AT }),
].map(questionState).join(", ")
=> pending, answered, dismissed, expired
```

## `answered-by` is gone — an unknown key is stripped, not rejected

```ts
const parsedWithAnsweredBy = QuestionSchema.frontmatterSchema.safeParse(
  baseFields({ "answered-by": "triage-agent" })
);
parsedWithAnsweredBy.success
=> true

"answered-by" in parsedWithAnsweredBy.data
=> false
```

## `learning`: sink/ref/proposal — proposal is required, sink is the retro vocabulary minus `question`

```ts
QuestionSchema.frontmatterSchema.safeParse(
  baseFields({ learning: { sink: "guide", proposal: "Receipts go in finance/." } })
).success
=> true

QuestionSchema.frontmatterSchema.safeParse(
  baseFields({
    learning: { sink: "briefing", ref: "briefing.briefing.card", proposal: "Boxholder is in Pacific time." },
  })
).success
=> true

QuestionSchema.frontmatterSchema.safeParse(baseFields({ learning: { sink: "guide" } })).success
=> false

QuestionSchema.frontmatterSchema.safeParse(
  baseFields({ learning: { sink: "question", proposal: "x" } })
).success
=> false
```

## `expires-after`: ISO-8601 duration format

Our duration pattern accepts day and time parts and refuses the bare designators:

```ts
const expiresAfter = (value: string) => QuestionSchema.frontmatterSchema.safeParse(baseFields({ "expires-after": value })).success;
Object.fromEntries(["P30D", "PT12H", "P1DT12H", "30d", "P", "PT"].map((value) => [value, expiresAfter(value)]))
=> { "P30D": true, "PT12H": true, "P1DT12H": true, "30d": false, "P": false, "PT": false }
```

## `asked-at`: ISO datetime with offset

```ts
QuestionSchema.frontmatterSchema.safeParse(baseFields({ "asked-at": ASKED_AT })).success
=> true

QuestionSchema.frontmatterSchema.safeParse(baseFields({ "asked-at": "2026-07-10" })).success
=> false
```

## Select template: sets `asked-at`, carries `learning`

```ts
createSelectQuestionTemplate({
  memo: "Context here",
  prompt: "What do you want?",
  options: [
    { id: "a", label: "Choice A" },
    { id: "b", label: "Choice B" },
  ],
  askedAt: ASKED_AT,
  learning: { sink: "guide", proposal: "Items like this belong in category A." },
})
=>
---
memo: Context here
prompt: What do you want?
input:
  type: select
  options:
    - id: a
      label: Choice A
    - id: b
      label: Choice B
learning:
  sink: guide
  proposal: Items like this belong in category A.
asked-at: 2026-07-10T09:00:00-07:00
---

```

## Text template: `asked-at` required, `learning`/`directive`/`expires-after` optional

```ts
createTextQuestionTemplate({
  memo: "Context",
  prompt: "What is this?",
  askedAt: ASKED_AT,
  directive: "File it.",
  expiresAfter: "P7D",
})
=>
---
memo: Context
prompt: What is this?
input:
  type: text
directive: File it.
asked-at: 2026-07-10T09:00:00-07:00
expires-after: P7D
---

```

## Option uniqueness: ids unique, labels unique case-insensitively

Answer resolution matches typed answers against option labels with
`toLowerCase()`, so two options differing only in case would be ambiguous:

```ts
QuestionSchema.frontmatterSchema.safeParse(
  baseFields({
    input: { type: "select", options: [{ id: "a", label: "A" }, { id: "a", label: "B" }] },
  })
).success
=> false

QuestionSchema.frontmatterSchema.safeParse(
  baseFields({
    input: { type: "select", options: [{ id: "a", label: "Yes" }, { id: "b", label: "yes" }] },
  })
).success
=> false

QuestionSchema.frontmatterSchema.safeParse(
  baseFields({
    input: { type: "select", options: [{ id: "a", label: "Yes" }, { id: "b", label: "No" }] },
  })
).success
=> true
```

## Lifecycle coherence: at most one timestamp, and an answer only with `answered-at`

`answered-at` requires `answer`; `answer` and `answered-via` require
`answered-at`; a card carries at most one of `answered-at`, `dismissed-at`,
`expired-at`.

```ts
QuestionSchema.frontmatterSchema.safeParse(baseFields({ "answered-at": ASKED_AT })).success
=> false

QuestionSchema.frontmatterSchema.safeParse(
  baseFields({ answer: { text: "Blue" }, "answered-at": ASKED_AT, "answered-via": "web" })
).success
=> true

QuestionSchema.frontmatterSchema.safeParse(baseFields({ answer: { text: "x" } })).success
=> false

QuestionSchema.frontmatterSchema.safeParse(baseFields({ "answered-via": "cli" })).success
=> false

QuestionSchema.frontmatterSchema.safeParse(
  baseFields({ answer: { text: "Blue" }, "answered-at": ASKED_AT, "dismissed-at": ASKED_AT })
).success
=> false

QuestionSchema.frontmatterSchema.safeParse(
  baseFields({ "dismissed-at": ASKED_AT, "expired-at": ASKED_AT })
).error?.issues.map((issue) => issue.message).join("; ")
=> "expired-at" must not appear with "dismissed-at"
```

## Confirm template: no options, `asked-at` still set

```ts
createConfirmQuestionTemplate({
  memo: "Context",
  prompt: "Is this right?",
  askedAt: ASKED_AT,
})
=>
---
memo: Context
prompt: Is this right?
input:
  type: confirm
asked-at: 2026-07-10T09:00:00-07:00
---

```

## Registered templates expose the answer contract (directive / learning / expires-after)

The `question`, `question-text`, and `question-confirm` bbx-create templates
accept optional `directive`, `learning`, and `expires-after` args and pass them
through to the builders. Validation is strict: a bad `expires-after` or a
`learning` missing its `proposal` is rejected at the args boundary.

```ts setup
import { getTemplate } from "../../src/templates-registry.js";

// Parse raw args through the template's own schema, then generate — exercising
// both the argsSchema (accepts the contract fields) and the passthrough.
function renderTemplate(name, rawArgs) {
  const def = getTemplate(name);
  if (def === undefined) throw new Error(`no template ${name}`);
  return def.generate(def.argsSchema.parse(rawArgs));
}
```

The text template carries `directive`, a `learning` block, and `expires-after`:

```ts
const card = renderTemplate("question-text", {
  memo: "Why",
  prompt: "What is this?",
  directive: "File it.",
  learning: { sink: "guide", proposal: "Items like this belong in category A." },
  "expires-after": "P7D",
});
card.includes("directive: File it.")
=> true

card.includes("Items like this belong in category A.")
=> true

card.includes("expires-after: P7D")
=> true
```

The select template threads the same fields alongside its options:

```ts
const card = renderTemplate("question", {
  memo: "Why",
  prompt: "Pick one",
  options: ["Finance", "Personal"],
  directive: "File the receipt",
});
card.includes("directive: File the receipt")
=> true

card.includes("label: Finance")
=> true
```

Strict arg validation — a malformed `expires-after` and a `learning` without a
`proposal` are both rejected at the args boundary (a `ZodError`):

```ts
renderTemplate("question-confirm", { memo: "m", prompt: "p", "expires-after": "7 days" })
=> throws ZodError

renderTemplate("question-text", { memo: "m", prompt: "p", learning: { sink: "guide" } })
=> throws ZodError
```
