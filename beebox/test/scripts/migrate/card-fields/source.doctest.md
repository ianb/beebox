# Migration: give `source` fields their specific names

`src/scripts/migrate/card-fields/source.ts` renames each `source` that is not a
derived-from pointer, and moves media acquisition times into the media
reference's `via` object (part 3 of `docs/implemented-plans/standard-card-fields.md`).
`planSourceFields(type, fm)` lists the edits for one card; `applyFieldEdits`
applies them to the YAML text.

```ts setup
import { parse, stringify } from "yaml";
import { planSourceFields } from "../../../../src/scripts/migrate/card-fields/source.js";
import { applyFieldEdits } from "../../../../src/core/card-fields/field-edits.js";
import { parseCardText } from "../../../../src/core/card-io.js";
import { createCardSchemaMap } from "../../../../src/schemas.js";
import { createGdocTemplate } from "../../../../src/schemas/gdoc.js";
import { createGsheetTemplate } from "../../../../src/schemas/gsheet.js";
import { createGfolderTemplate } from "../../../../src/schemas/gfolder.js";
import { createGlinkTemplate } from "../../../../src/schemas/glink.js";

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
run("doc", { title: "A page", source: "https://example.com/a" })
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

## Pointers: webpage, recipe and record `sources`

A webpage's page URL and capture instant become its one `sources` entry, in
the place `source` held. The capture instant keeps its full precision; the
view formats it:

```ts
migrateText("webpage", [
  "title: A page",
  "source: https://example.com/a",
  "captured: 2026-07-09T14:00:15.000Z",
  "siteName: Example",
  "frozen:",
  "  ref: attach/page.frozen",
  "",
].join("\n"))
=>
title: A page
sources:
  - href: https://example.com/a
    retrieved: 2026-07-09T14:00:15.000Z
siteName: Example
frozen:
  ref: attach/page.frozen

run("webpage", { title: "Imported", source: "https://example.com/b" })
=> {"changed":true,"warnings":[],"fm":{"title":"Imported","sources":[{"href":"https://example.com/b"}]}}
```

A recipe's `source` object becomes the one entry of `sources`; a label with
nothing to point at stays a label:

```ts
run("recipe", { title: "Soup", source: { label: "Serious Eats", href: "https://example.com/soup" }, tags: ["soup"] })
=> {"changed":true,"warnings":[],"fm":{"title":"Soup","sources":[{"label":"Serious Eats","href":"https://example.com/soup"}],"tags":["soup"]}}

run("recipe", { title: "Pie", source: { label: "Grandma" } })
=> {"changed":true,"warnings":[],"fm":{"title":"Pie","sources":[{"label":"Grandma"}]}}
```

A record `sources` entry's `time` is a moment in a transcript, which the
`{% source %}` tag calls `pos`:

```ts
run("record", { name: "Couch", sources: [{ ref: "/_content/s.capture-session.card", time: "at 1:23", note: "Named here" }, { href: "https://example.com" }] })
=> {"changed":true,"warnings":[],"fm":{"name":"Couch","sources":[{"ref":"/_content/s.capture-session.card","pos":"at 1:23","note":"Named here"},{"href":"https://example.com"}]}}
```

## Named fields: commentary, browser-task, tab-arrangement, image text

```ts
run("commentary", { title: "Notes", source: "https://example.com/a" })
=> {"changed":true,"warnings":[],"fm":{"title":"Notes","about":{"href":"https://example.com/a"}}}

// The page's capture date goes with the page, as the `sources` entry names it.
run("commentary", { source: "https://example.com/a", captured: "2026-07-09", frozen: { ref: "attach/a.html" } })
=> {"changed":true,"warnings":[],"fm":{"about":{"href":"https://example.com/a","retrieved":"2026-07-09"},"frozen":{"ref":"attach/a.html"}}}

run("commentary", { about: { href: "https://example.com/a" }, captured: "2026-07-09" })
=> {"changed":true,"warnings":[],"fm":{"about":{"href":"https://example.com/a","retrieved":"2026-07-09"}}}

run("browser-task", { title: "Guild", source: "https://example.com/feed", watermark: "2026-09-01" })
=> {"changed":true,"warnings":[],"fm":{"title":"Guild","start":{"href":"https://example.com/feed"},"watermark":"2026-09-01"}}

run("tab-arrangement", { "captured-at": "2026-08-01T00:00:00Z", source: { windows: [] }, proposal: { windows: [], close: [] } })
=> {"changed":true,"warnings":[],"fm":{"captured-at":"2026-08-01T00:00:00Z","captured-tabs":{"windows":[]},"proposal":{"windows":[],"close":[]}}}
```

An image's text blocks rename `source` to `surface`, alongside its media
reference's `via`:

```ts
run("image", { filename: { ref: "attach/p.jpg", captured: "2026-07-09T14:00:15Z", source: "scan-import" }, text: [{ source: "back", content: "May 72" }, { content: "EXIT" }] })
=> {"changed":true,"warnings":[],"fm":{"filename":{"ref":"attach/p.jpg","via":{"channel":"scan-import","at":"2026-07-09T14:00:15Z"}},"text":[{"surface":"back","content":"May 72"},{"content":"EXIT"}]}}
```

Each migrated card loads under the current schemas:

```ts
const pointerSchemas = await createCardSchemaMap();
const tabs = { windows: [{ id: "8f0e7c4e-8d3c-4b8e-9b1a-1c2d3e4f5a6b", tabs: [{ id: "0b9e1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d", title: "A", url: "https://example.com/a", pinned: false }] }] };
const pointerCards = [
  ["x.webpage.card", "title: A page\nsource: https://example.com/a\ncaptured: 2026-07-09T14:00:15.000Z\n", "sources"],
  ["x.recipe.card", "title: Pie\nsource:\n  label: Grandma\n", "sources"],
  ["x.record.card", "name: Couch\nsources:\n  - ref: /x.capture-session.card\n    time: at 1:23\n", "sources"],
  ["x.commentary.card", "source: https://example.com/a\ncaptured: 2026-07-09\n", "about"],
  ["x.browser-task.card", "title: Guild\nsource: https://example.com/feed\n", "start"],
  ["x.tab-arrangement.card", stringify({ "transfer-id": "5f3c2b1a-0e9d-4c8b-a7f6-e5d4c3b2a190", scope: "current-window", "captured-at": "2026-08-01T00:00:00Z", source: tabs, proposal: { windows: [{ id: tabs.windows[0].id, tabs: [tabs.windows[0].tabs[0].id] }], close: [] } }), "captured-tabs"],
  ["x.image.card", "filename:\n  ref: attach/p.jpg\n  captured: 2026-07-09T14:00:15Z\n  source: scan\ntext:\n  - source: back\n    content: May 72\n", "text"],
].map(([file, yaml, key]) => {
  const type = file.replace(/^x\./, "").replace(/\.card$/, "");
  const parsed = parseCardText(`---\n${migrateText(type, yaml)}---\n`, { source: file, schemas: pointerSchemas });
  return parsed.fields[key];
});
JSON.stringify(pointerCards.map((value) => Object.keys(value)))
=> [["0"],["0"],["0"],["href","retrieved"],["href"],["windows"],["0"]]
```

## Email cards: the copied Gmail data moves under `email:`

email-message's headers, `snippet` and `date` (Gmail's arrival time, now
`received`) move under `email:`, where the first of them was; the
`body-file` and `attachments` pointers stay. email-thread moves its
`thread-id`, `subject`, `participants`, `date-range` and `labels`, and keeps
`messages`. Inside `email:` the keys take the order the connector writes, and
a key the card does not have (`cc`) is not added:

```ts
migrateText("email-message", [
  "message-id: <m1@example.com>",
  "thread-id: 18c2f0a1",
  "from: alice@example.com",
  "to: bob@example.com",
  "date: 2026-05-14T19:00:00.000Z",
  "subject: Weekend plans",
  "snippet: Hey, are you free Saturday...",
  "body-file:",
  "  ref: attach/msg-001.body.txt",
  "contains: Alice asks about Saturday.",
  "",
].join("\n"))
=>
email:
  message-id: <m1@example.com>
  thread-id: 18c2f0a1
  from: alice@example.com
  to: bob@example.com
  received: 2026-05-14T19:00:00.000Z
  subject: Weekend plans
  snippet: Hey, are you free Saturday...
body-file:
  ref: attach/msg-001.body.txt
contains: Alice asks about Saturday.

run("email-thread", { "thread-id": "18c2f0a1", subject: "Weekend plans", participants: ["alice@example.com"], "date-range": { start: "2026-05-14T19:00:00Z", end: "2026-05-14T19:00:00Z" }, messages: [{ ref: "attach/msg-001.email-message.card" }], labels: ["inbox"] })
=> {"changed":true,"warnings":[],"fm":{"email":{"thread-id":"18c2f0a1","subject":"Weekend plans","participants":["alice@example.com"],"date-range":{"start":"2026-05-14T19:00:00Z","end":"2026-05-14T19:00:00Z"},"labels":["inbox"]},"messages":[{"ref":"attach/msg-001.email-message.card"}]}}
```

Both load under the current schemas, and a card is listed under its subject:

```ts continue
const emailSchemas = await createCardSchemaMap();
const thread = parseCardText(`---\n${migrateText("email-thread", "thread-id: t1\nsubject: Hi\nparticipants: []\ndate-range:\n  start: 2026-05-14T19:00:00Z\n  end: 2026-05-14T19:00:00Z\nmessages: []\n")}---\n`, { source: "x.email-thread.card", schemas: emailSchemas });
const message = parseCardText(`---\n${migrateText("email-message", "message-id: m1\nthread-id: t1\nfrom: a@x\ndate: 2026-05-14T19:00:00Z\nsubject: Hi\nbody-file:\n  ref: attach/b.txt\n")}---\n`, { source: "x.email-message.card", schemas: emailSchemas });
JSON.stringify([thread.fields["email"]["thread-id"], message.fields["email"]["received"]])
=> ["t1","2026-05-14T19:00:00Z"]
```

## Drive cards: the copied Drive metadata moves under `drive:`

gdoc and gsheet move `drive-id` (as `id`), `link`, `owner`, `modified` and
gdoc's `revision` under `drive:`; `title`, the content pointers, `lossy` and
`conflict` stay. gfolder and glink move `drive-id`, `link` and glink's `mime`,
and their `name` (the Drive name) becomes `title` in place:

```ts
run("gfolder", { "drive-id": "folder-1", name: "Recipes", link: "https://drive.google.com/drive/folders/folder-1", "last-sync": "2026-09-01T10:00:00Z", "not-in-folder": 2, contains: "Recipes shared with the family." })
=> {"changed":true,"warnings":[],"fm":{"drive":{"id":"folder-1","link":"https://drive.google.com/drive/folders/folder-1"},"title":"Recipes","last-sync":"2026-09-01T10:00:00Z","not-in-folder":2,"contains":"Recipes shared with the family."}}

run("gfolder", { "drive-id": "folder-1" })
=> {"changed":true,"warnings":[],"fm":{"drive":{"id":"folder-1"}}}
```

A card the connector wrote in the old shape migrates to exactly what the
connector writes now, so the next sync does not rewrite it. The old layouts
below are the old templates' key order:

```ts continue
const old = (fields: Record<string, unknown>) => stringify(fields);
const now = (card: string) => card.replace(/^---\n/, "").replace(/---\n$/, "");
const link = "https://docs.google.com/document/d/doc-1/edit";
JSON.stringify([
  migrateText("gdoc", old({ "drive-id": "doc-1", title: "Trip Notes", modified: "2026-09-01T10:00:00.000Z", link, owner: "o@example.com", content: { ref: "attach/Trip_Notes.md" }, comments: { ref: "attach/Trip_Notes.comments.json" }, revision: "rev-9", lossy: [{ type: "images", count: 2 }], conflict: true }))
    === now(createGdocTemplate({ driveId: "doc-1", title: "Trip Notes", modified: "2026-09-01T10:00:00.000Z", revision: "rev-9", link, owner: "o@example.com", contentFile: "Trip_Notes.md", commentsFile: "Trip_Notes.comments.json", lossy: [{ type: "images", count: 2 }], conflict: true })),
  migrateText("gsheet", old({ "drive-id": "sheet-1", title: "Budget", modified: "2026-09-01T10:00:00.000Z", link, owner: "o@example.com", sheets: [{ ref: "attach/Sheet1.json", title: "Sheet1", gid: "0" }] }))
    === now(createGsheetTemplate({ driveId: "sheet-1", title: "Budget", modified: "2026-09-01T10:00:00.000Z", link, owner: "o@example.com", sheets: [{ ref: "attach/Sheet1.json", title: "Sheet1", gid: "0" }] })),
  migrateText("gfolder", old({ "drive-id": "folder-1", name: "Recipes", link }))
    === now(createGfolderTemplate({ driveId: "folder-1", name: "Recipes", link })),
  migrateText("glink", old({ "drive-id": "pdf-1", link, name: "Lease.pdf", mime: "application/pdf", origin: "mirror" }))
    === now(createGlinkTemplate({ driveId: "pdf-1", link, name: "Lease.pdf", mime: "application/pdf", origin: "mirror", notes: "" })),
])
=> [true,true,true,true]
```

Each loads under the current schemas:

```ts continue
const driveSchemas = await createCardSchemaMap();
JSON.stringify([
  ["gdoc", "drive-id: d1\ntitle: Notes\nmodified: 2026-09-01\nlink: https://x\nowner: o@x\ncontent:\n  ref: attach/Notes.md\n"],
  ["gsheet", "drive-id: s1\ntitle: Budget\nmodified: 2026-09-01\nlink: https://x\nowner: o@x\nsheets: []\n"],
  ["gfolder", "drive-id: f1\nname: Recipes\n"],
  ["glink", "drive-id: p1\nlink: https://x\nname: Lease.pdf\nmime: application/pdf\norigin: manual\n"],
].map(([type, yaml]) => parseCardText(`---\n${migrateText(type, yaml)}---\n`, { source: `x.${type}.card`, schemas: driveSchemas }).fields["drive"]["id"]))
=> ["d1","s1","f1","p1"]
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

run("webpage", { title: "A page", sources: [{ href: "https://example.com/a", retrieved: "2026-07-09T14:00:15.000Z" }] })
=> {"changed":false,"warnings":[],"fm":{"title":"A page","sources":[{"href":"https://example.com/a","retrieved":"2026-07-09T14:00:15.000Z"}]}}

run("browser-task", { title: "Guild", start: { href: "https://example.com/feed" } })
=> {"changed":false,"warnings":[],"fm":{"title":"Guild","start":{"href":"https://example.com/feed"}}}

run("email-thread", { email: { "thread-id": "t1", subject: "Hi" }, messages: [] })
=> {"changed":false,"warnings":[],"fm":{"email":{"thread-id":"t1","subject":"Hi"},"messages":[]}}

run("glink", { drive: { id: "p1", link: "https://x", mime: "application/pdf" }, title: "Lease.pdf", origin: "manual" })
=> {"changed":false,"warnings":[],"fm":{"drive":{"id":"p1","link":"https://x","mime":"application/pdf"},"title":"Lease.pdf","origin":"manual"}}
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

refusal("webpage", { source: "https://example.com/a", sources: [{ href: "https://example.com/a" }] })
=> UnmappedFieldError: webpage source has both the old and the new keys; migrate this card by hand

refusal("webpage", { captured: "2026-07-09T14:00:15Z", sources: [{ href: "https://example.com/a" }] })
=> UnmappedFieldError: webpage captured has both the old and the new keys; migrate this card by hand

refusal("webpage", { title: "A page", captured: "2026-07-09T14:00:15Z" })
=> UnmappedFieldError: webpage captured is missing a key the new shape requires; migrate this card by hand

refusal("recipe", { title: "Soup", source: { href: "https://example.com/soup", ref: "attach/soup.webpage.card" } })
=> UnmappedFieldError: recipe source has both `ref` and `href`, and the new shape takes one; migrate this card by hand

refusal("recipe", { title: "Soup", source: "Grandma" })
=> UnmappedFieldError: recipe source is not a map; migrate this card by hand

refusal("browser-task", { source: "https://example.com/a", start: { href: "https://example.com/b" } })
=> UnmappedFieldError: browser-task source has both the old and the new keys; migrate this card by hand

refusal("record", { sources: [{ ref: "/x.card", time: "at 1:23", pos: "at 1:24" }] })
=> UnmappedFieldError: record sources.0.time has both the old and the new keys; migrate this card by hand

refusal("commentary", { title: "Notes", captured: "2026-07-09" })
=> UnmappedFieldError: commentary captured is missing a key the new shape requires; migrate this card by hand

refusal("commentary", { about: { href: "https://example.com/a", retrieved: "2026-07-01" }, captured: "2026-07-09" })
=> UnmappedFieldError: commentary captured has both the old and the new keys; migrate this card by hand

refusal("email-message", { email: { "message-id": "m1" }, date: "2026-05-14T19:00:00Z" })
=> UnmappedFieldError: email-message date has both the old and the new keys; migrate this card by hand

refusal("gdoc", { "drive-id": "d1", drive: { id: "d1" } })
=> UnmappedFieldError: gdoc drive-id has both the old and the new keys; migrate this card by hand

refusal("glink", { drive: { id: "p1" }, name: "Lease.pdf", title: "Lease" })
=> UnmappedFieldError: glink name has both the old and the new keys; migrate this card by hand
```
