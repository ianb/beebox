# Migration: give `source` fields their specific names

`src/scripts/migrate/source-fields.ts` renames each `source` that is not a
derived-from pointer, and moves media acquisition times into the media
reference's `via` object (part 3 of `docs/plans/standard-card-fields.md`).
`planSourceFields(type, fm)` lists the edits for one card; `applyFieldEdits`
applies them to the YAML text.

```ts setup
import { parse, stringify } from "yaml";
import { planSourceFields } from "../../../src/scripts/migrate/source-fields.js";
import { applyFieldEdits } from "../../../src/scripts/migrate/_field-edits.js";
import { parseCardText } from "../../../src/core/card-io.js";
import { createCardSchemaMap } from "../../../src/schemas.js";

// Plan the edits for a card, apply them to its YAML, and report the result.
function run(type: string, fm: Record<string, unknown>): string {
  const plan = planSourceFields(type, fm);
  const migrated: unknown = parse(applyFieldEdits(stringify(fm), plan.edits));
  return JSON.stringify({ changed: plan.edits.length > 0, warnings: plan.warnings, fm: migrated });
}

// The migrated frontmatter text, for checking layout.
function migrateText(type: string, yaml: string): string {
  return applyFieldEdits(yaml, planSourceFields(type, parse(yaml)).edits);
}

function refusal(type: string, fm: Record<string, unknown>): string {
  try {
    planSourceFields(type, fm);
    return "no error";
  } catch (e) {
    return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
}
```

## A type the migration doesn't handle is unchanged

```ts
run("webpage", { title: "A page", source: "https://example.com/a" })
=> {"changed":false,"warnings":[],"fm":{"title":"A page","source":"https://example.com/a"}}
```

## Media references: the time and channel become `filename.via`

image, file and pdf move `filename.captured` to `via.at` and
`filename.source` to `via.channel`; audio's time is `filename.recorded`. `via`
lands right after `ref`, and the other keys, comments included, stay where
they were:

```ts
migrateText("pdf", [
  "format: pdf",
  "filename:",
  "  ref: attach/source.pdf # the original",
  "  captured: 2026-04-02T10:23:00Z",
  "  source: scan-upload/study-scansnap",
  "  original-name: utility-bill.pdf",
  "  size: 248392",
  "",
].join("\n"))
=>
format: pdf
filename:
  ref: attach/source.pdf # the original
  via:
    channel: scan-upload/study-scansnap
    at: 2026-04-02T10:23:00Z
  original-name: utility-bill.pdf
  size: 248392

run("image", { filename: { ref: "attach/photo-001.jpg", captured: "2026-07-09T14:00:15.000Z", source: "camera-user" }, description: "A porch railing" })
=> {"changed":true,"warnings":[],"fm":{"filename":{"ref":"attach/photo-001.jpg","via":{"channel":"camera-user","at":"2026-07-09T14:00:15.000Z"}},"description":"A porch railing"}}

run("file", { filename: { ref: "attach/notes.txt", captured: "2026-07-09T14:00:00Z", source: "disk", "mime-type": "text/plain" } })
=> {"changed":true,"warnings":[],"fm":{"filename":{"ref":"attach/notes.txt","via":{"channel":"disk","at":"2026-07-09T14:00:00Z"},"mime-type":"text/plain"}}}

run("audio", { filename: { ref: "attach/audio-001.webm", recorded: "2026-07-09T14:00:00Z", source: "microphone", duration: "12s" }, transcript: "So the porch..." })
=> {"changed":true,"warnings":[],"fm":{"filename":{"ref":"attach/audio-001.webm","via":{"channel":"microphone","at":"2026-07-09T14:00:00Z"},"duration":"12s"},"transcript":"So the porch..."}}
```

The migrated cards load under the current schemas:

```ts
const schemas = await createCardSchemaMap();
const image = migrateText("image", "filename:\n  ref: attach/p.jpg\n  captured: 2026-07-09T14:00:15Z\n  source: gallery\n");
const audio = migrateText("audio", "filename:\n  ref: attach/a.webm\n  recorded: 2026-07-09T14:00:00Z\n  source: microphone\n");
JSON.stringify([
  parseCardText(`---\n${image}---\n`, { source: "p.image.card", schemas }).fields.filename.via,
  parseCardText(`---\n${audio}---\n`, { source: "a.audio.card", schemas }).fields.filename.via,
])
=> [{"channel":"gallery","at":"2026-07-09T14:00:15Z"},{"channel":"microphone","at":"2026-07-09T14:00:00Z"}]
```

## feedback: `source` becomes `via.channel`, where `source` was

```ts
migrateText("feedback", [
  "type-of-feedback: comment",
  "target:",
  "  ref: /_content/briefings/2026-02-01.briefing.card#q1",
  "source: voice",
  "timestamp: 2026-02-01T09:00:00Z",
  "",
].join("\n"))
=>
type-of-feedback: comment
target:
  ref: /_content/briefings/2026-02-01.briefing.card#q1
via:
  channel: voice
timestamp: 2026-02-01T09:00:00Z
```

## Job cards: `source` is dropped or becomes `connector`

The three single-producer job types drop their constant `source`; a value
other than the constant is dropped too, with a warning:

```ts
run("contains-backfill-job", { source: "contains-backfill", priority: "low", description: "Write contains", items: [] })
=> {"changed":true,"warnings":[],"fm":{"priority":"low","description":"Write contains","items":[]}}

run("question-followup-job", { source: "question-answer", description: "Follow up", directive: "File it.", answer: "blue" })
=> {"changed":true,"warnings":[],"fm":{"description":"Follow up","directive":"File it.","answer":"blue"}}

run("todo-review-job", { source: "hand-made", priority: "normal", description: "Review" })
=> {"changed":true,"warnings":["todo-review-job source \"hand-made\" dropped"],"fm":{"priority":"normal","description":"Review"}}
```

A chat job's `source` names its connector and becomes `connector`, in place:

```ts
migrateText("chat-job", "source: telegram\ndescription: New message\nthread:\n  ref: store/chat/t.chat-thread.card\n")
=>
connector: telegram
description: New message
thread:
  ref: store/chat/t.chat-thread.card
```

An intake job's `wakeup`, `wakeup-captures` and `scan` name no connector and
are dropped (the pair only repeated `priority`); any other value is the
connector whose scoped wakeup made the job:

```ts
JSON.stringify(["wakeup", "wakeup-captures", "scan", "gmail"].map((source) =>
  parse(migrateText("intake-job", `source: ${source}\npriority: normal\ndescription: Triage\nitems: []\n`))))
=> [{"priority":"normal","description":"Triage","items":[]},{"priority":"normal","description":"Triage","items":[]},{"priority":"normal","description":"Triage","items":[]},{"connector":"gmail","priority":"normal","description":"Triage","items":[]}]
```

## Beliefs: `source` becomes `basis`

On guide triage rules and on personality relationships, tone and traits, each
entry's `source` is renamed in place; entries without one are left alone:

```ts
migrateText("guide", [
  "triage-rules:",
  "  - text: Receipts go to finance",
  "    confidence: low",
  "    source: default",
  "  - text: Ask about travel",
  "    confidence: medium",
  "",
].join("\n"))
=>
triage-rules:
  - text: Receipts go to finance
    confidence: low
    basis: default
  - text: Ask about travel
    confidence: medium

run("personality", {
  boxholder: { relationships: [{ text: "Prefers terse replies", source: "user-stated" }] },
  tone: [{ text: "Warm", confidence: "low", source: "default" }],
  traits: [{ text: "Curious", source: "inferred", ref: "x" }],
})
=> {"changed":true,"warnings":[],"fm":{"boxholder":{"relationships":[{"text":"Prefers terse replies","basis":"user-stated"}]},"tone":[{"text":"Warm","confidence":"low","basis":"default"}],"traits":[{"text":"Curious","basis":"inferred","ref":"x"}]}}
```

## Schedules and capture sessions: `reason` and `uploader`

```ts
run("scheduled-script", { cron: "0 5 * * *", runs: "bbx procedure run refresh-maps", source: { text: "Daily check", ref: "_content/notes/why.memo.card" } })
=> {"changed":true,"warnings":[],"fm":{"cron":"0 5 * * *","runs":"bbx procedure run refresh-maps","reason":{"text":"Daily check","ref":"_content/notes/why.memo.card"}}}

run("capture-session", { "session-id": "s1", source: "scan-upload/study-scansnap", files: ["attach/a.pdf.card"] })
=> {"changed":true,"warnings":[],"fm":{"session-id":"s1","uploader":"scan-upload/study-scansnap","files":["attach/a.pdf.card"]}}
```

A migrated card of each of these types loads under the current schemas:

```ts
const jobSchemas = await createCardSchemaMap();
const loaded = [
  ["x.intake.job.card", "source: gmail\npriority: low\ndescription: Triage\nitems: []\n", "connector"],
  ["x.chat.job.card", "source: telegram\ndescription: New\nthread:\n  ref: t.chat-thread.card\n", "connector"],
  ["x.guide.card", "triage-rules:\n  - text: A rule\n    source: user-stated\n", "triage-rules"],
  ["x.scheduled-script.card", "runs: bbx wakeup\nsource: Why\n", "reason"],
  ["x.capture-session.card", "session-id: s1\nsource: scan-upload/desk\n", "uploader"],
].map(([file, yaml, key]) => {
  const type = file.replace(/^x\./, "").replace(/\.card$/, "").replace(".job", "-job");
  const fields = parseCardText(`---\n${migrateText(type, yaml)}---\n`, { source: file, schemas: jobSchemas }).fields;
  return fields[key];
});
JSON.stringify(loaded)
=> ["gmail","telegram",[{"text":"A rule","confidence":"low","basis":"user-stated"}],"Why","scan-upload/desk"]
```

## A migrated card is unchanged

```ts
run("image", { filename: { ref: "attach/p.jpg", via: { channel: "gallery", at: "2026-07-09T14:00:15Z", original: "1974" } } })
=> {"changed":false,"warnings":[],"fm":{"filename":{"ref":"attach/p.jpg","via":{"channel":"gallery","at":"2026-07-09T14:00:15Z","original":"1974"}}}}

run("feedback", { target: { ref: "/x#y" }, via: { channel: "text" } })
=> {"changed":false,"warnings":[],"fm":{"target":{"ref":"/x#y"},"via":{"channel":"text"}}}

run("intake-job", { connector: "gmail", priority: "normal", description: "Triage", items: [] })
=> {"changed":false,"warnings":[],"fm":{"connector":"gmail","priority":"normal","description":"Triage","items":[]}}

run("personality", { tone: [{ text: "Warm", basis: "default" }] })
=> {"changed":false,"warnings":[],"fm":{"tone":[{"text":"Warm","basis":"default"}]}}
```

## A card the migration cannot convert safely is refused

Old and new keys together, a `filename` that is not a map, and a media
reference with only one of the two old keys each fail the card, unchanged:

```ts
refusal("image", { filename: { ref: "attach/p.jpg", captured: "2026-07-09T14:00:15Z", via: { channel: "gallery", at: "2026-07-09T14:00:15Z" } } })
=> UnmappedFieldError: image filename has both the old and the new keys; migrate this card by hand

refusal("feedback", { source: "voice", via: { channel: "text" } })
=> UnmappedFieldError: feedback source has both the old and the new keys; migrate this card by hand

refusal("file", { filename: "attach/notes.txt" })
=> UnmappedFieldError: file filename is not a map; migrate this card by hand

refusal("audio", { filename: { ref: "attach/a.webm", source: "microphone" } })
=> UnmappedFieldError: audio filename is missing a key the new shape requires; migrate this card by hand

refusal("intake-job", { source: "gmail", connector: "gmail" })
=> UnmappedFieldError: intake-job source has both the old and the new keys; migrate this card by hand

refusal("guide", { "triage-rules": [{ text: "A rule", source: "inferred", basis: "user-stated" }] })
=> UnmappedFieldError: guide triage-rules.0.source has both the old and the new keys; migrate this card by hand
```
