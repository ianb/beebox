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

## A migrated card is unchanged

```ts
run("image", { filename: { ref: "attach/p.jpg", via: { channel: "gallery", at: "2026-07-09T14:00:15Z", original: "1974" } } })
=> {"changed":false,"warnings":[],"fm":{"filename":{"ref":"attach/p.jpg","via":{"channel":"gallery","at":"2026-07-09T14:00:15Z","original":"1974"}}}}

run("feedback", { target: { ref: "/x#y" }, via: { channel: "text" } })
=> {"changed":false,"warnings":[],"fm":{"target":{"ref":"/x#y"},"via":{"channel":"text"}}}
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
```
