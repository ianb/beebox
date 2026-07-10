# Question follow-up job schema

Created by the answer command when a question is answered — carries the
directive, the answer, and (when the question declared one) the `learning`
passthrough so the follow-up agent doesn't need to re-read the question
card's frontmatter shape. See `test/schemas/question.doctest.md` for the
question card itself and `docs/plans/questions-end-to-end.md` for the
two-product contract.

```ts setup
import {
  QuestionFollowupJobSchema,
  createQuestionFollowupJobTemplate,
} from "../../src/schemas/question-followup-job.js";
```

## Registered as `question-followup-job`

```ts
QuestionFollowupJobSchema.type
=> question-followup-job
```

## `learning` is an optional passthrough, same shape as the question's

```ts
QuestionFollowupJobSchema.frontmatterSchema.safeParse({
  type: "question-followup-job",
  status: "pending",
  source: "question-answer",
  description: "Follow up",
  "question-ref": { ref: "box/questions/X.question.card" },
  directive: "Do the thing",
  answer: "yes",
}).success
=> true

QuestionFollowupJobSchema.frontmatterSchema.safeParse({
  type: "question-followup-job",
  status: "pending",
  source: "question-answer",
  description: "Follow up",
  "question-ref": { ref: "box/questions/X.question.card" },
  directive: "Do the thing",
  answer: "yes",
  learning: { sink: "guide", proposal: "Items like this belong in category A." },
}).success
=> true

QuestionFollowupJobSchema.frontmatterSchema.safeParse({
  type: "question-followup-job",
  status: "pending",
  source: "question-answer",
  description: "Follow up",
  "question-ref": { ref: "box/questions/X.question.card" },
  directive: "Do the thing",
  answer: "yes",
  learning: { sink: "guide" },
}).success
=> false
```

## Template without `learning`

```ts
createQuestionFollowupJobTemplate({
  description: "Follow up on answered question: What color?",
  questionRef: "box/questions/X.question.card",
  directive: "File it.",
  answer: "blue",
})
=>
---
status: pending
source: question-answer
description: "Follow up on answered question: What color?"
question-ref:
  ref: box/questions/X.question.card
directive: File it.
answer: blue
---

```

## Template with `learning`

```ts
createQuestionFollowupJobTemplate({
  description: "Follow up on answered question: What color?",
  questionRef: "box/questions/X.question.card",
  directive: "File it.",
  answer: "blue",
  learning: { sink: "guide", proposal: "Items like this belong in category A." },
})
=>
---
status: pending
source: question-answer
description: "Follow up on answered question: What color?"
question-ref:
  ref: box/questions/X.question.card
directive: File it.
answer: blue
learning:
  sink: guide
  proposal: Items like this belong in category A.
---

```
