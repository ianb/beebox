# Migration runner: every card-field planner in one pass

`src/scripts/migrate/card-fields/run.ts` is the script behind all three
card-field migrations (`standard-fields-2026-09`, `status-fields-2026-09`,
`source-fields-2026-09`). A box's pre-commit hook validates each migration
commit against the current schemas, so a card has to reach its final shape in
one commit: the runner applies the standard, status and source planners
together, and whichever registry entry runs first converts everything.

```ts setup
import { parse, stringify } from "yaml";
import { planCardFields, CARD_FIELD_TYPES } from "../../../../src/scripts/migrate/card-fields/run.js";
import { applyFieldEdits } from "../../../../src/core/card-fields/field-edits.js";

function run(type: string, fm: Record<string, unknown>): string {
  const plan = planCardFields(type, fm);
  return JSON.stringify({ edits: plan.edits.length, warnings: plan.warnings, fm: parse(applyFieldEdits(stringify(fm), plan.edits)) });
}
```

## An audio card in the pre-migration shape converts completely in one pass

Its `status` and `summary` (standard), and its `filename.recorded`/`source`
(source) all change together, so the result validates against the current
audio schema.

```ts
run("audio", { status: "transcribed", filename: { ref: "attach/a.webm", recorded: "2026-05-01T10:00:00Z", source: "microphone", duration: "12s" }, summary: "", transcript: "Hello" })
=> {"edits":5,"warnings":[],"fm":{"filename":{"ref":"attach/a.webm","via":{"channel":"microphone","at":"2026-05-01T10:00:00Z"},"duration":"12s"},"transcript":"Hello"}}
```

## A converted card is already done, and every planner's types are covered

```ts
run("audio", { filename: { ref: "attach/a.webm", via: { channel: "microphone", at: "2026-05-01T10:00:00Z" } }, transcript: "Hello" })
=> {"edits":0,"warnings":[],"fm":{"filename":{"ref":"attach/a.webm","via":{"channel":"microphone","at":"2026-05-01T10:00:00Z"}},"transcript":"Hello"}}

["audio", "intake-job", "question", "gdoc", "webpage", "record"].every((t) => CARD_FIELD_TYPES.has(t))
=> true
```
