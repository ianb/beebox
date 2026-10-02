# Migration: replace remaining `status` fields

`src/scripts/migrate/card-fields/status.ts` replaces each card type's `status`
with the specific fact it recorded (part 2 of
`docs/implemented-plans/standard-card-fields.md`). `planStatusFields(type, fm)` lists the
edits for one card; `applyFieldEdits` applies them to the YAML text.

```ts setup
import { parse, stringify } from "yaml";
import { planStatusFields } from "../../../../src/scripts/migrate/card-fields/status.js";
import { applyFieldEdits } from "../../../../src/core/card-fields/field-edits.js";
import { createInitialGuideTemplate } from "../../../../src/schemas/guide/templates.js";

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

## telegram-message: `delivery-error` records a failure

A pending card is simply one without `delivery-error`. A failed card keeps
its `error` text as `delivery-error`; one with no `error` gets a fixed
message saying the reason was never recorded.

```ts
run("telegram-message", { status: "pending", "chat-id": "7", text: "hi" })
=> {"changed":true,"warnings":[],"fm":{"chat-id":"7","text":"hi"}}

run("telegram-message", { status: "sent", "chat-id": "7", text: "hi" })
=> {"changed":true,"warnings":[],"fm":{"chat-id":"7","text":"hi"}}

run("telegram-message", { status: "failed", "chat-id": "7", text: "hi", error: "403: bot was blocked" })
=> {"changed":true,"warnings":[],"fm":{"chat-id":"7","text":"hi","delivery-error":"403: bot was blocked"}}

run("telegram-message", { status: "failed", "chat-id": "7", text: "hi" })
=> {"changed":true,"warnings":[],"fm":{"chat-id":"7","text":"hi","delivery-error":"Delivery failed before this card recorded why (the failure predates delivery-error)"}}
```

## browser-task, tab-arrangement, person, place: named booleans

An `inactive` person or place is archived.

```ts
run("browser-task", { status: "open", source: "https://example.test/feed" })
=> {"changed":true,"warnings":[],"fm":{"source":"https://example.test/feed"}}

run("browser-task", { status: "closed", source: "https://example.test/feed" })
=> {"changed":true,"warnings":[],"fm":{"source":"https://example.test/feed","closed":true}}

run("tab-arrangement", { "transfer-id": "t1", status: "draft" })
=> {"changed":true,"warnings":[],"fm":{"transfer-id":"t1"}}

run("tab-arrangement", { "transfer-id": "t1", status: "ready" })
=> {"changed":true,"warnings":[],"fm":{"transfer-id":"t1","ready":true}}

run("person", { status: "active", name: "Priya Marlowe" })
=> {"changed":true,"warnings":[],"fm":{"name":"Priya Marlowe"}}

run("person", { status: "inactive", name: "Jo Smith" })
=> {"changed":true,"warnings":[],"fm":{"name":"Jo Smith","archived":true}}

run("place", { status: "archived", name: "Old Office" })
=> {"changed":true,"warnings":[],"fm":{"name":"Old Office","archived":true}}
```

## todo-view and progress entries: renamed, value kept

A todo-view's `status` filters todos by their status; a progress entry's is
the learner's mastery level.

```ts
run("todo-view", { glob: "**", status: ["open", "done"] })
=> {"changed":true,"warnings":[],"fm":{"glob":"**","todo-status":["open","done"]}}

run("progress", { entries: [
  { node: "acids", status: "partial", basis: "observed", evidence: ["said so"] },
  { node: "bases", status: "solid", basis: "observed", evidence: ["showed it"] },
] })
=> {"changed":true,"warnings":[],"fm":{"entries":[{"node":"acids","basis":"observed","evidence":["said so"],"level":"partial"},{"node":"bases","basis":"observed","evidence":["showed it"],"level":"solid"}]}}
```

## lesson-plan segments: `planned: true`, and `ready` goes

```ts
run("lesson-plan", { segments: [
  { do: "Elicit their model", mode: "interactive" },
  { do: "Read the recap", mode: "material", status: "ready", material: { ref: "Recap.doc.card" } },
  { do: "A figure", mode: "material", status: "planned" },
] })
=> {"changed":true,"warnings":[],"fm":{"segments":[{"do":"Elicit their model","mode":"interactive"},{"do":"Read the recap","mode":"material","material":{"ref":"Recap.doc.card"}},{"do":"A figure","mode":"material","planned":true}]}}
```

## guide and personality experiments: `active: true` or an `outcome`

A proposed experiment has neither.

```ts
run("guide", { version: "1.0.0", experiments: [
  { id: "a", status: "proposed", hypothesis: "h" },
  { id: "b", status: "active", hypothesis: "h" },
  { id: "c", status: "mixed", conclusion: "Half of it held" },
  { id: "d" },
] })
=> {"changed":true,"warnings":[],"fm":{"version":"1.0.0","experiments":[{"id":"a","hypothesis":"h"},{"id":"b","hypothesis":"h","active":true},{"id":"c","conclusion":"Half of it held","outcome":"mixed"},{"id":"d"}]}}

run("personality", { version: "1.0.0", experiments: [{ id: "x", status: "successful" }, { id: "y", status: "unsuccessful" }, { id: "z", status: "inconclusive" }] })
=> {"changed":true,"warnings":[],"fm":{"version":"1.0.0","experiments":[{"id":"x","outcome":"successful"},{"id":"y","outcome":"unsuccessful"},{"id":"z","outcome":"inconclusive"}]}}
```

A stock guide, migrated, is byte-identical to the current template (which
writes `active: true` last in the entry, where the migration puts it), so the
template tracker finds it unchanged instead of parking the new version. The
old stock form is the current one with `status: active` after the id:

```ts
const migratedStock = ["intake", "calendar", "drive", "scan", "chat", "other"].map((name) => {
  const current = createInitialGuideTemplate({ name });
  const old = current.replace("\n    active: true\n", "\n").replace(/(\n {2}- id: [^\n]+\n)/, "$1    status: active\n");
  const fmText = old.slice("---\n".length, -"---\n".length);
  return old !== current && `---\n${applyFieldEdits(fmText, planStatusFields("guide", parse(fmText)).edits)}---\n` === current;
});
JSON.stringify(migratedStock)
=> [true,true,true,true,true,true]
```

## gdoc: `conflict: true`, and the rest goes

The connector recomputes the card on every pull, and only ever wrote
`synced` or `conflict`.

```ts
run("gdoc", { "drive-id": "d1", status: "synced", title: "Notes" })
=> {"changed":true,"warnings":[],"fm":{"drive-id":"d1","title":"Notes"}}

run("gdoc", { "drive-id": "d1", status: "new", title: "Notes" })
=> {"changed":true,"warnings":[],"fm":{"drive-id":"d1","title":"Notes"}}

run("gdoc", { "drive-id": "d1", status: "error", title: "Notes" })
=> {"changed":true,"warnings":[],"fm":{"drive-id":"d1","title":"Notes"}}

run("gdoc", { "drive-id": "d1", status: "conflict", title: "Notes" })
=> {"changed":true,"warnings":[],"fm":{"drive-id":"d1","title":"Notes","conflict":true}}
```

## gfolder: `error` alone says the last sync failed

A failed mount keeps its `error`; one with no `error` text gets a fixed
message.

```ts
run("gfolder", { "drive-id": "f1", status: "ok", "last-sync": "2026-09-01T00:00:00Z" })
=> {"changed":true,"warnings":[],"fm":{"drive-id":"f1","last-sync":"2026-09-01T00:00:00Z"}}

run("gfolder", { "drive-id": "f1", status: "error", "last-sync": "2026-09-01T00:00:00Z", error: "folder is in Drive trash" })
=> {"changed":true,"warnings":[],"fm":{"drive-id":"f1","last-sync":"2026-09-01T00:00:00Z","error":"folder is in Drive trash"}}

run("gfolder", { "drive-id": "f1", status: "error", "last-sync": "2026-09-01T00:00:00Z" })
=> {"changed":true,"warnings":[],"fm":{"drive-id":"f1","last-sync":"2026-09-01T00:00:00Z","error":"The last sync failed before this card recorded why (the failure predates the error field)"}}
```

## procedure-run: a finished run's result becomes its `outcome`

A run with no outcome has not finished. A `running` card may be a live run or
an interrupted one; either way it has no outcome, and `bbx procedure resume`
still continues it.

```ts
run("procedure-run", { procedure: "p.procedure.card", status: "running", "started-at": "2026-09-01T00:00:00Z", steps: [{ id: "s", status: "running" }] })
=> {"changed":true,"warnings":[],"fm":{"procedure":"p.procedure.card","started-at":"2026-09-01T00:00:00Z","steps":[{"id":"s","status":"running"}]}}

run("procedure-run", { procedure: "p.procedure.card", status: "pending", "started-at": "2026-09-01T00:00:00Z", steps: [] })
=> {"changed":true,"warnings":[],"fm":{"procedure":"p.procedure.card","started-at":"2026-09-01T00:00:00Z","steps":[]}}

run("procedure-run", { procedure: "p.procedure.card", status: "failed", "started-at": "2026-09-01T00:00:00Z", steps: [{ id: "s", status: "failed" }] })
=> {"changed":true,"warnings":[],"fm":{"procedure":"p.procedure.card","started-at":"2026-09-01T00:00:00Z","steps":[{"id":"s","status":"failed"}],"outcome":"failed"}}

run("procedure-run", { procedure: "p.procedure.card", status: "completed", "started-at": "2026-09-01T00:00:00Z", steps: [] })
=> {"changed":true,"warnings":[],"fm":{"procedure":"p.procedure.card","started-at":"2026-09-01T00:00:00Z","steps":[],"outcome":"completed"}}

run("procedure-run", { procedure: "p.procedure.card", status: "inconclusive", "started-at": "2026-09-01T00:00:00Z", steps: [{ id: "s", status: "completed", validate: { status: "inconclusive" } }] })
=> {"changed":true,"warnings":[],"fm":{"procedure":"p.procedure.card","started-at":"2026-09-01T00:00:00Z","steps":[{"id":"s","status":"completed","validate":{"status":"inconclusive"}}],"outcome":"inconclusive"}}
```

## question: the lifecycle timestamps say the state, so `status` goes

`status` is dropped when the lifecycle fields agree with it: none for
`pending`, `answer` and `answered-at` for `answered`, `dismissed-at` or
`expired-at` for the other two.

```ts
run("question", { status: "pending", prompt: "Where?", "asked-at": "2026-09-01T00:00:00Z" })
=> {"changed":true,"warnings":[],"fm":{"prompt":"Where?","asked-at":"2026-09-01T00:00:00Z"}}

run("question", { status: "answered", prompt: "Where?", answer: { text: "Here" }, "answered-at": "2026-09-02T00:00:00Z", "answered-via": "web" })
=> {"changed":true,"warnings":[],"fm":{"prompt":"Where?","answer":{"text":"Here"},"answered-at":"2026-09-02T00:00:00Z","answered-via":"web"}}

run("question", { status: "dismissed", prompt: "Where?", "dismissed-at": "2026-09-02T00:00:00Z" })
=> {"changed":true,"warnings":[],"fm":{"prompt":"Where?","dismissed-at":"2026-09-02T00:00:00Z"}}

run("question", { status: "expired", prompt: "Where?", "expired-at": "2026-10-01T00:00:00Z" })
=> {"changed":true,"warnings":[],"fm":{"prompt":"Where?","expired-at":"2026-10-01T00:00:00Z"}}
```

A status the fields contradict is refused, as is an unknown value. Neither
card could load before this change.

```ts
refusal("question", { status: "pending", prompt: "Where?", "dismissed-at": "2026-09-02T00:00:00Z" })
=> UnmappedStatusError: question (lifecycle fields disagree) status "pending" has no safe mapping; migrate this card by hand

refusal("question", { status: "answered", prompt: "Where?", "answered-at": "2026-09-02T00:00:00Z" })
=> UnmappedStatusError: question (lifecycle fields disagree) status "answered" has no safe mapping; migrate this card by hand

refusal("question", { status: "expired", prompt: "Where?", "expired-at": "2026-10-01T00:00:00Z", "dismissed-at": "2026-09-02T00:00:00Z" })
=> UnmappedStatusError: question (lifecycle fields disagree) status "expired" has no safe mapping; migrate this card by hand

refusal("question", { status: "closed", prompt: "Where?" })
=> UnmappedStatusError: question status "closed" has no safe mapping; migrate this card by hand
```

## A migrated card is unchanged

```ts
run("capture-session", { "session-id": "s1", delivered: true, annotated: true })
=> {"changed":false,"warnings":[],"fm":{"session-id":"s1","delivered":true,"annotated":true}}

run("image", { filename: { ref: "attach/p.jpg" }, unusable: true })
=> {"changed":false,"warnings":[],"fm":{"filename":{"ref":"attach/p.jpg"},"unusable":true}}

run("telegram-message", { "chat-id": "7", text: "hi", "delivery-error": "timeout" })
=> {"changed":false,"warnings":[],"fm":{"chat-id":"7","text":"hi","delivery-error":"timeout"}}

run("todo-view", { "todo-status": ["open"] })
=> {"changed":false,"warnings":[],"fm":{"todo-status":["open"]}}

run("guide", { experiments: [{ id: "b", active: true }, { id: "c", outcome: "mixed" }] })
=> {"changed":false,"warnings":[],"fm":{"experiments":[{"id":"b","active":true},{"id":"c","outcome":"mixed"}]}}

run("progress", { entries: [{ node: "acids", level: "partial" }] })
=> {"changed":false,"warnings":[],"fm":{"entries":[{"node":"acids","level":"partial"}]}}

run("gdoc", { "drive-id": "d1", conflict: true })
=> {"changed":false,"warnings":[],"fm":{"drive-id":"d1","conflict":true}}

run("gfolder", { "drive-id": "f1", error: "timeout" })
=> {"changed":false,"warnings":[],"fm":{"drive-id":"f1","error":"timeout"}}

run("procedure-run", { procedure: "p", outcome: "failed", steps: [{ id: "s", status: "failed" }] })
=> {"changed":false,"warnings":[],"fm":{"procedure":"p","outcome":"failed","steps":[{"id":"s","status":"failed"}]}}

run("question", { prompt: "Where?", "dismissed-at": "2026-09-02T00:00:00Z" })
=> {"changed":false,"warnings":[],"fm":{"prompt":"Where?","dismissed-at":"2026-09-02T00:00:00Z"}}
```

## A value outside the old enum is refused

```ts
refusal("capture-session", { status: "filed", "session-id": "s1" })
=> UnmappedStatusError: capture-session status "filed" has no safe mapping; migrate this card by hand

refusal("image", { status: "constructor" })
=> UnmappedStatusError: image status "constructor" has no safe mapping; migrate this card by hand

refusal("upload-batch", { status: true })
=> UnmappedStatusError: upload-batch status true has no safe mapping; migrate this card by hand

refusal("person", { status: "deceased", name: "X" })
=> UnmappedStatusError: person status "deceased" has no safe mapping; migrate this card by hand

refusal("guide", { experiments: [{ id: "a", status: "active" }, { id: "b", status: "paused" }] })
=> UnmappedStatusError: guide experiments[1] status "paused" has no safe mapping; migrate this card by hand

refusal("lesson-plan", { segments: [{ do: "x", mode: "material", status: "drafted" }] })
=> UnmappedStatusError: lesson-plan segments[0] status "drafted" has no safe mapping; migrate this card by hand
```

A pending telegram message that carries an `error` is refused, since it is
unclear whether it should be retried; so is a rename whose target already
exists.

```ts
refusal("telegram-message", { status: "pending", "chat-id": "7", text: "hi", error: "kaboom" })
=> UnmappedStatusError: telegram-message status "pending" has no safe mapping; migrate this card by hand

refusal("telegram-message", { status: "queued", "chat-id": "7", text: "hi" })
=> UnmappedStatusError: telegram-message status "queued" has no safe mapping; migrate this card by hand

refusal("progress", { entries: [{ node: "n", status: "solid", level: "partial" }] })
=> UnmappedStatusError: progress entries[0] (already has level) status "solid" has no safe mapping; migrate this card by hand
```

An `ok` folder mount that still carries an `error` is refused: the new shape
would read it as failed. So is a run card that already has an `outcome`, and
any value outside each type's old enum.

```ts
refusal("gfolder", { "drive-id": "f1", status: "ok", error: "stale" })
=> UnmappedStatusError: gfolder status "ok" has no safe mapping; migrate this card by hand

refusal("gfolder", { "drive-id": "f1", status: "paused" })
=> UnmappedStatusError: gfolder status "paused" has no safe mapping; migrate this card by hand

refusal("gdoc", { "drive-id": "d1", status: "stale" })
=> UnmappedStatusError: gdoc status "stale" has no safe mapping; migrate this card by hand

refusal("procedure-run", { procedure: "p", status: "completed", outcome: "failed", steps: [] })
=> UnmappedStatusError: procedure-run (already has outcome) status "completed" has no safe mapping; migrate this card by hand

refusal("procedure-run", { procedure: "p", status: "cancelled", steps: [] })
=> UnmappedStatusError: procedure-run status "cancelled" has no safe mapping; migrate this card by hand
```
