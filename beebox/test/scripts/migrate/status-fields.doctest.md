# Migration: replace remaining `status` fields

`src/scripts/migrate/status-fields.ts` replaces each card type's `status`
with the specific fact it recorded (part 2 of
`docs/plans/standard-card-fields.md`). `planStatusFields(type, fm)` lists the
edits for one card; `applyFieldEdits` applies them to the YAML text.

```ts setup
import { parse, stringify } from "yaml";
import { planStatusFields } from "../../../src/scripts/migrate/status-fields.js";
import { applyFieldEdits } from "../../../src/scripts/migrate/_field-edits.js";

// Plan the edits for a card, apply them to its YAML, and report the result.
function run(type: string, fm: Record<string, unknown>): string {
  const plan = planStatusFields(type, fm);
  const migrated: unknown = parse(applyFieldEdits(stringify(fm), plan.edits));
  return JSON.stringify({ changed: plan.edits.length > 0, warnings: plan.warnings, fm: migrated });
}

function refusal(type: string, fm: Record<string, unknown>): string {
  try {
    planStatusFields(type, fm);
    return "no error";
  } catch (e) {
    return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
}
```

## A type the migration doesn't handle is unchanged

```ts
run("doc", { title: "Notes", status: "whatever" })
=> {"changed":false,"warnings":[],"fm":{"title":"Notes","status":"whatever"}}

refusal("doc", { status: "x" })
=> no error
```

## audio: the transcript records transcription, so `status` goes

A `transcribed` clip with no transcript is warned about: it now reads as
untranscribed.

```ts
run("audio", { status: "transcribed", filename: { ref: "attach/a.webm" }, transcript: "So the porch..." })
=> {"changed":true,"warnings":[],"fm":{"filename":{"ref":"attach/a.webm"},"transcript":"So the porch..."}}

run("audio", { status: "new", filename: { ref: "attach/a.webm" }, "transcription-error": { permanent: false, message: "timeout" } })
=> {"changed":true,"warnings":[],"fm":{"filename":{"ref":"attach/a.webm"},"transcription-error":{"permanent":false,"message":"timeout"}}}

run("audio", { status: "transcribed", filename: { ref: "attach/a.webm" } })
=> {"changed":true,"warnings":["audio marked transcribed has no transcript; it now reads as untranscribed"],"fm":{"filename":{"ref":"attach/a.webm"}}}
```

## image and pdf: `invalid` becomes `unusable: true`

`new` and `analyzed` are dropped; the description or the extraction (and a
pdf's `error`) already say how far analysis got.

```ts
run("image", { status: "analyzed", filename: { ref: "attach/p.jpg" }, description: "A porch railing" })
=> {"changed":true,"warnings":[],"fm":{"filename":{"ref":"attach/p.jpg"},"description":"A porch railing"}}

run("image", { status: "invalid", filename: { ref: "attach/p.jpg" } })
=> {"changed":true,"warnings":[],"fm":{"filename":{"ref":"attach/p.jpg"},"unusable":true}}

run("pdf", { status: "new", format: "pdf", error: "docling exited 1" })
=> {"changed":true,"warnings":[],"fm":{"format":"pdf","error":"docling exited 1"}}

run("pdf", { status: "analyzed", format: "pdf", docling: { ref: "attach/docling.json.gz" } })
=> {"changed":true,"warnings":[],"fm":{"format":"pdf","docling":{"ref":"attach/docling.json.gz"}}}

run("pdf", { status: "invalid", format: "pdf" })
=> {"changed":true,"warnings":[],"fm":{"format":"pdf","unusable":true}}
```

## capture-session and upload-batch: `delivered` and `annotated` become booleans

An annotated capture was delivered first. The retired pipeline's
`intake-complete` and `extracted` sessions were annotated but never delivered
to chat; its `transcribing` and `transcribed` stopped before annotation.

```ts
run("capture-session", { status: "new", "session-id": "s1" })
=> {"changed":true,"warnings":[],"fm":{"session-id":"s1"}}

run("capture-session", { status: "delivered", "session-id": "s1" })
=> {"changed":true,"warnings":[],"fm":{"session-id":"s1","delivered":true}}

run("capture-session", { status: "annotated", "session-id": "s1" })
=> {"changed":true,"warnings":[],"fm":{"session-id":"s1","delivered":true,"annotated":true}}

run("capture-session", { status: "extracted", "session-id": "s1" })
=> {"changed":true,"warnings":[],"fm":{"session-id":"s1","annotated":true}}

run("capture-session", { status: "intake-complete", "session-id": "s1" })
=> {"changed":true,"warnings":[],"fm":{"session-id":"s1","annotated":true}}

run("capture-session", { status: "transcribed", "session-id": "s1" })
=> {"changed":true,"warnings":[],"fm":{"session-id":"s1"}}

run("upload-batch", { status: "delivered", "batch-id": "b1" })
=> {"changed":true,"warnings":[],"fm":{"batch-id":"b1","delivered":true}}

run("upload-batch", { status: "new", "batch-id": "b1" })
=> {"changed":true,"warnings":[],"fm":{"batch-id":"b1"}}
```

## A migrated card is unchanged

```ts
run("capture-session", { "session-id": "s1", delivered: true, annotated: true })
=> {"changed":false,"warnings":[],"fm":{"session-id":"s1","delivered":true,"annotated":true}}

run("image", { filename: { ref: "attach/p.jpg" }, unusable: true })
=> {"changed":false,"warnings":[],"fm":{"filename":{"ref":"attach/p.jpg"},"unusable":true}}
```

## A value outside the old enum is refused

```ts
refusal("capture-session", { status: "filed", "session-id": "s1" })
=> UnmappedStatusError: capture-session status "filed" has no safe mapping; migrate this card by hand

refusal("image", { status: "constructor" })
=> UnmappedStatusError: image status "constructor" has no safe mapping; migrate this card by hand

refusal("upload-batch", { status: true })
=> UnmappedStatusError: upload-batch status true has no safe mapping; migrate this card by hand
```
