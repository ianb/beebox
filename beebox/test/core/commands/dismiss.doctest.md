# `bbx dismiss` — decline a pending question

Dismissing sets `dismissed-at` on a pending question, under the same guarded atomic commit as `answer` — but it writes NO
follow-up job. Only a pending question can be dismissed.

```ts setup
import { executeDismiss } from "../../../src/core/commands/dismiss.js";
import { createCollectorContext } from "../../../src/core/command-runner.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

async function dismiss(box, args) {
  const { ctx } = createCollectorContext(box.root);
  return executeDismiss(ctx, args);
}

const PENDING = `---
prompt: Where does this receipt go?
input:
  type: text
---
`;
```

## Dismisses a pending question, no follow-up job

```ts
const box = await makeTmpBox({ git: true });
await box.write("_bookkeeping/questions/Receipt.question.card", PENDING);

const res = await dismiss(box, { question: "_bookkeeping/questions/Receipt.question.card" });
res.success
=> true

const card = await box.read("_bookkeeping/questions/Receipt.question.card");
card.includes("dismissed-at:")
=> true
```

No follow-up job is created (dismissal has no directive to execute):

```ts continue
(await box.list("_bookkeeping/jobs")).includes(".card")
=> false
```

```ts cleanup
await box.cleanup();
```

## Only a pending question can be dismissed

```ts
const box = await makeTmpBox({ git: true });
await box.write(
  "_bookkeeping/questions/Done.question.card",
  // A coherent answered card carries its answer + answered-at (schema-required).
  PENDING.replace(
    "---\n",
    "---\nanswered-at: 2026-01-01T00:00:00-07:00\nanswer:\n  text: Done\n",
  ),
);

const res = await dismiss(box, { question: "_bookkeeping/questions/Done.question.card" });
res.success
=> false

res.error
=> Question is answered, not pending; only a pending question can be dismissed
```

```ts cleanup
await box.cleanup();
```
