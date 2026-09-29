# Migration: strip standard fields that had no job

`src/scripts/migrate/standard-fields.ts` removes the `status`, `created`,
`summary` and observation `date` fields that part 1 of
`docs/plans/standard-card-fields.md` took out of the schemas.
`planStandardFields(type, fm)` lists the edits for one card, plus warnings for
dropped content; `applyFieldEdits` applies them to the frontmatter text
through the `yaml` document model, so untouched keys keep their formatting.

```ts setup
import { parse, stringify } from "yaml";
import { planStandardFields } from "../../../src/scripts/migrate/standard-fields.js";
import { applyFieldEdits } from "../../../src/scripts/migrate/_field-edits.js";

// Plan the edits for a card, apply them to its YAML, and report the result.
function run(type: string, fm: Record<string, unknown>): string {
  const plan = planStandardFields(type, fm);
  const migrated: unknown = parse(applyFieldEdits(stringify(fm), plan.edits));
  return JSON.stringify({ changed: plan.edits.length > 0, warnings: plan.warnings, fm: migrated });
}

function refusal(type: string, fm: Record<string, unknown>): string {
  try {
    planStandardFields(type, fm);
    return "no error";
  } catch (e) {
    return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
}
```

## Job cards lose their always-pending `status` and a leftover `created`

```ts
run("intake-job", { status: "pending", created: "2026-01-01T00:00:00Z", source: "wakeup", description: "Triage 2 items", items: [{ ref: "/_content/inbox/a.memo.card" }] })
=> {"changed":true,"warnings":[],"fm":{"source":"wakeup","description":"Triage 2 items","items":[{"ref":"/_content/inbox/a.memo.card"}]}}
```

## pub-submission loses `status` and `created`; `submitted-at` stays

```ts
run("pub-submission", { status: "new", created: "2026-09-01T10:00:00Z", "pub-id": "p1", "submitted-at": "2026-09-01T09:59:00Z" })
=> {"changed":true,"warnings":[],"fm":{"pub-id":"p1","submitted-at":"2026-09-01T09:59:00Z"}}
```

## record: `draft` goes, `reviewed` and `archived` become booleans

```ts
run("record", { status: "draft", name: "Oak dresser" })
=> {"changed":true,"warnings":[],"fm":{"name":"Oak dresser"}}

run("record", { status: "reviewed", name: "Oak dresser" })
=> {"changed":true,"warnings":[],"fm":{"name":"Oak dresser","reviewed":true}}

run("record", { status: "archived", name: "1998 tax return" })
=> {"changed":true,"warnings":[],"fm":{"name":"1998 tax return","archived":true}}
```

## An unmapped value is refused, leaving the card for a person

A record status outside the old enum has no mapping. An email-outbound that
is not `draft` would, once its status is dropped, upload as a draft, so it is
refused too.

```ts
refusal("record", { status: "lost", name: "Lamp" })
=> UnmappedStatusError: record status "lost" has no safe mapping; migrate this card by hand

refusal("email-outbound", { status: "sent", to: "dana@example.com", subject: "Hi" })
=> UnmappedStatusError: email-outbound status "sent" has no safe mapping; migrate this card by hand

run("email-outbound", { status: "draft", to: "dana@example.com", subject: "Hi" })
=> {"changed":true,"warnings":[],"fm":{"to":"dana@example.com","subject":"Hi"}}
```

## audio `summary` is dropped, with a warning when it held text

```ts
run("audio", { status: "transcribed", filename: { ref: "attach/a.webm" }, summary: "Talked about the porch.", transcript: "So the porch..." })
=> {"changed":true,"warnings":["dropped a non-empty audio summary (the transcript stays)"],"fm":{"status":"transcribed","filename":{"ref":"attach/a.webm"},"transcript":"So the porch..."}}

run("audio", { status: "transcribed", filename: { ref: "attach/a.webm" }, summary: "", transcript: "So the porch..." })
=> {"changed":true,"warnings":[],"fm":{"status":"transcribed","filename":{"ref":"attach/a.webm"},"transcript":"So the porch..."}}
```

## Experiment observations lose `date`

```ts
run("guide", { version: "1.0.0", experiments: [{ id: "x", status: "active", observations: [{ text: "Worked", date: "2026-09-02" }] }] })
=> {"changed":true,"warnings":[],"fm":{"version":"1.0.0","experiments":[{"id":"x","status":"active","observations":[{"text":"Worked"}]}]}}
```

## Idempotent: a migrated card, or another type, is unchanged

```ts
run("record", { name: "Oak dresser", reviewed: true })
=> {"changed":false,"warnings":[],"fm":{"name":"Oak dresser","reviewed":true}}

run("question", { status: "pending", prompt: "Which one?" })
=> {"changed":false,"warnings":[],"fm":{"status":"pending","prompt":"Which one?"}}
```

## Untouched keys keep their exact text

Only the removed key's lines change; a long value folded at the `yaml`
library's default width (how cards on disk were written), quoting, and a
comment stay as they were.

```ts
const text = "status: draft\nname: Oak dresser\n# checked 2026-09\ndescription: A long description that was folded by an earlier writer at eighty\n  columns and should stay folded.\nnotes: \"quoted\"\n";
JSON.stringify(applyFieldEdits(text, planStandardFields("record", parse(text)).edits))
=> "name: Oak dresser\n# checked 2026-09\ndescription: A long description that was folded by an earlier writer at eighty\n  columns and should stay folded.\nnotes: \"quoted\"\n"
```
