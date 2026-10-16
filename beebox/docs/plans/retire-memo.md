---
title: "Retire the memo card type into doc"
status: draft
workstream: retire-memo
issues:
  - ../../../issues/code-quality/2026-09-27-retire-memo-card-type-into-doc.md
  - ../../../issues/code-quality/2026-08-22-memo-source-vs-emission-origin-vocabulary.md
---
# Retire the memo card type into doc

The memo card type goes away. A captured note becomes a `doc` card. A voice
note's recording, transcript and transcription error move onto an `audio` card
in the doc's attach scope. A script migration converts every existing memo.

**Issues addressed:**
[retire memo](../../../issues/code-quality/2026-09-27-retire-memo-card-type-into-doc.md)
(the anchor);
[memo `source` vs emission `origin`](../../../issues/code-quality/2026-08-22-memo-source-vs-emission-origin-vocabulary.md)
(settled here: memo's `source` becomes `via.channel`, see Track B).
Searched the queue for `memo`, `voice note`, `quick capture` title: the
[standard card fields](../implemented-plans/standard-card-fields.md) plan
deferred memo's `status`, `created`, `source` and body-derived title to this
work (`standard-card-fields.md:504`: *"Retiring memo. Its own issue; this plan
leaves memo's fields until then"*). No other open item covers memo.

## Design

### Situations

- When Priya dictates a thought into her phone while walking the dog, I want
  it saved even if transcription fails, so I can find the recording later and
  know whether the words were heard.
- When Tomas shares a paragraph from a web page to the box, I want the box to
  keep what it said about where the text came from (the page title, or the
  URL when one was shared), so the filing chat and later readers can cite it.
- When an agent grows a captured note into a talk draft over several days, I
  want the card to look like every other document in that folder (a title,
  no `status: new`, no `created` time), so the folder reads as one set of
  documents.
- When Priya looks at a list of captures nobody has filed yet, she does not
  want the box to retitle or rewrite them on its own; the filing chat or she
  decides the title.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Voice note arrives | Act: save the recording at once, transcribe after | `Voice note.doc.card` in `_content/captures/`; `recording.audio.card` inside its attach scope | Background; the capture's chat delivery is unchanged |
| Shared URL or clipping | Act: save the URL in `sources`; clipping title and text in the body | The doc | Background |
| Note grows into a document | Quiet: nothing to convert; it is already a doc | The doc itself | None |
| Unfiled captures | Quiet: the title stays "Voice note" or "Saved capture" until someone files it | Captures folder listing | Waits to be found |

### Spirit

- **Serves:** "see the gears". The transcript and its error sit on the audio
  card beside the recording, where a person or agent can see them, instead
  of in fields on the note.
- **Risks:** "messy is fine". A doc requires a title, which can push agents
  to invent one. Guard: capture code writes a plain placeholder ("Voice
  note", "Saved capture"); the doc instructions say the filing agent replaces
  it, and the migration derives titles from what the memo already showed.

### Trust

Shows only, takes no new action. Capture and transcription already run
automatically; this changes the card they write, not when they run.

### When it goes wrong or does nothing

- Transcription fails: the audio card carries `transcription-error:` with
  the message; the doc still links the recording. Same information as the
  memo had, one card lower.
- Migration cannot derive a title (empty body, no transcript, no recording):
  title is the humanised filename (`file-summary.ts` rule), never empty.

### Walkthrough

Priya records a voice note on the phone (no typed words). The phone posts it
to quick capture. `materializeCaptureSource` writes
`_content/captures/<id>.doc.card` (`title: Voice note`, `share-id`,
`via: {channel: apple-voice-recording}`) and
`<id>.attach/recording.audio.card` (`filename: {ref: attach/recording.m4a,
via: {channel: microphone, at: <capturedAt>}}`) with the audio at
`<id>.attach/recording.attach/recording.m4a`, and commits. The worker
transcribes and writes `transcript:` onto the audio card. The capture is
delivered to a chat as today; that chat files it with `bbx mv` and writes a
title and body. The phone's "Open saved source" opens the doc
(`QuickCaptureViews.swift:290` opens `card/<sourceRef>`, an opaque path).

## Smallest fix and budget

**Smallest fix:** stop new memos (templates, quick capture) and leave old ones
loading. Rejected: the boxholder's direction is to remove the type, and
leaving it loadable keeps the misuse the issue describes.

**Chosen design, estimated changed lines (additions plus deletions):**

| Track | Source | Tests |
|---|---|---|
| A. doc gains `via` and `sources`; memo schema, templates, registrations removed | 250 | 80 |
| B. Quick capture writes a doc plus audio card | 200 | 250 |
| C. Transcribe pre-action, prompts, agent guide, schema instructions | 80 | 40 |
| D. Migration `retire-memo-2026-10` | 350 | 250 |
| E. Test fixtures that use `.memo.card` as a generic card | 0 | ~1,600 (mechanical) |

Total about 3,100 lines, of which about 1,600 are mechanical fixture swaps
(`grep -rn '\.memo\.card' test src/frontend/test` finds 937 lines in about 140
files; an unknown type throws at `src/core/card-io.ts:119-120`: *"no schema
registered for type"*). **BIG CHANGE**, driven by fixture churn, not design.
Authored docs (glossary, mobile contract, box layout, event bus): about 60
lines, separate.

## Stated preferences this plan trades against

- **Boxholder decisions (2026-10-16, this workstream):** voice notes use an
  audio card in the attach scope; new voice docs carry a placeholder title the
  filing agent replaces; migrated titles come from a deterministic chain;
  provenance is kept as doc `via: {channel}` and `sources`, never as `source`.
- **Standard card fields** (`docs/implemented-plans/standard-card-fields.md`
  Ontology): `created` banned, `source` reserved for derived-from, `via` is
  how something arrived, `via.at` is the only valid creation time. This plan
  applies those names; it adds no vocabulary.
- **Bias toward strict / fail closed:** the migration aborts with nothing
  written when any memo has a field it does not map (bbx-migration: *"A
  warning is data the migrator silently drops"*).
- **Short compatibility horizon** (bbx-migration skill): no dual loader for
  memo; a box that has not run the migration fails loudly on its memos.

## What already exists

- `audio` card: `src/schemas/audio.tsx:33-41` already has `filename: {ref,
  via, duration?}`, `transcript`, `transcription-error`. Reuse as is.
- `via` shape: `mediaVia()` in `src/cards/media-via.ts:25-32`; feedback uses a
  top-level `via` (`src/schemas/feedback.tsx:26`). Reuse.
- `sources` entry: `SourcesEntrySchema` in `src/cards/sources-entry.ts`
  (`ref|href`, `label`, `retrieved`). Reuse.
- `doc` already has `share-id` (`src/schemas/doc.tsx:24`). Reuse for quick
  capture identity.
- Audio card template: `createAudioTemplate` (`src/schemas/audio.tsx:66-77`).
- Annex-safe move: `movePathPreservingAnnexSymlink`
  (`src/core/card-files/move-phase2.ts:82`). Reuse in the migration so an
  annexed recording moved one directory deeper keeps a valid link.
- Title from filename: `src/core/file-summary.ts:67` (*"Meeting_Notes.memo.card"
  → "Meeting Notes"*). Reuse for the last fallback.
- Migration runner shape: `src/scripts/migrate/briefing-openers/{plan,run}.ts`
  (plan → apply → verify; a planning failure exits 1 with nothing written).
  Copy the shape; writes go through `writeFileAtomic` so an interrupted write
  never leaves a truncated card.
- Image material in quick capture already lands as an image card in the
  attach scope (`src/core/quick-capture/source.ts:117-126`). Audio follows.

## Prior art (external)

No design decision depends on an external premise; nothing searched.

## Ontology

No new nouns. Names used, all existing:

- **doc** (`src/schemas/doc.tsx:17`) — titled prose card. Gains optional
  `via` and `sources`.
- **`via`** on doc — `{ channel, note? }`: how the content arrived
  (`apple-share-extension`, `telegram`, `text`). No `at`: a doc is not media;
  the capture time lives on a media card's `via.at` when media exists. Not the
  emission `origin` (`typed|voice`), which is one interactive act in the
  frontend (`src/frontend/src/input/emission.ts:44`).
- **`sources`** on doc — what the content was derived from; a clipped page is
  `{ href, label? }`.
- **audio card** — the recording, its transcript and its transcription error.
- **retained quick-capture source** — the doc with `share-id` that quick
  capture writes (`src/core/quick-capture/source.ts`). Was a memo.

## Tracks / scope

### Track A — doc schema; memo removed

- **What.** Add optional `via: mediaVia(z.string()).omit({ at: true,
  original: true })` and `sources: z.array(SourcesEntrySchema).optional()` to
  `DocSchema`. Rewrite doc instructions: drop *"A captured note or voice memo —
  use `.memo.card`"* (`doc.tsx:77`); add a short "Captured notes" section
  carrying memo's retained-quick-capture rules (`memo.ts:76-84`) and the voice
  layout. Delete `src/schemas/memo.ts`, its registration (`src/schemas.ts:28,99`),
  the `memo` and `voice-memo` templates (`src/templates/builtins/templates.ts:27-45`),
  the file-type registration (`src/frontend/src/file-types/builtins.tsx:27`).
  Add a retired-type hint so `no schema registered for type "memo"` says
  *"memo was retired; use doc"* (`card-io.ts:120`).
- **Why.** The issue: memos grow into documents and keep the wrong type.
- **Vocabulary lock-ins.** doc `via.channel` and doc `sources`.
- **First chunk.** Schema change plus `test/schemas*.doctest.md` updates.

### Track B — quick capture writes doc plus audio card

- **What.** `materializeCaptureSource` writes `<id>.doc.card` with `title`,
  `share-id` and `via: {channel: declaration.source}`. URL material: `sources:
  [{href: url, label?: title}]`. Clipping material has no URL
  (`src/shared/quick-capture.ts:17`), so its title and text both go into the
  body: a "Clipped from “<title>”" line when a title exists, then the text
  as a blockquote. Audio material: `recording.audio.card` in the attach
  scope, the audio at `recording.attach/recording<ext>`, `via: {channel:
  "microphone", at: capturedAt}`; the body links
  `attach/recording.audio.card`.
- `writeSourceTranscription` re-resolves the current source with
  `findCaptureSource` inside the doc's card lock, then writes `transcript` or
  `transcription-error` onto that doc's audio card. A filing chat that moved
  the doc while the provider ran no longer makes the write miss
  (`worker.ts:73-88` holds `sourceRef` across the provider call today).
  `prepareVoice` sets `record.transcript` only after the card write succeeds,
  so a failed write is retried. Language is dropped (boxholder, 2026-10-16).
- `findCaptureSource` and the router's delete (`quick-capture.ts:151`) use
  `.doc.card` and `attachDirFor` (`src/shared/attach-path.ts:45`) instead of
  a `.memo.card` regex.
- **Legacy guard.** When `findCaptureSource` finds no doc but a `.memo.card`
  with the same `share-id` exists, it throws a `migration-pending`
  `QuickCaptureError` instead of returning null. Without it, a box whose
  migration failed would tombstone the capture as deleted
  (`source.ts:72`, *"The saved source was deleted."*), and a later
  successful migration would not undo that. A text scan for `share-id`, with
  no memo parsing. Listed in the settling-period cleanup issue.
- **Why.** Quick capture is the only live producer of memos.
- **Contract.** `sourceRef` stays an opaque path; iOS opens it as
  `card/<sourceRef>` (`ios-app/BeeBox/Views/QuickCaptureViews.swift:290`).
  `docs/mobile-contract.md:1396-1411` prose changes from "memo" to "doc"; no
  wire change.
- **First chunk.** Text-only capture writes a doc; quick-capture doctests
  updated.

### Track C — transcription pre-action, agent guidance

- **What.** `transcribe.ts:73` `appliesTo` becomes `["feedback"]`. Update
  memo mentions in `agent-guide/guide.md:79,285,406`, `capture-session.tsx:84`,
  `guide/templates.tsx:26,76,81`, `bbx-commands.ts:57-58`,
  `views/doc/examples.ts`, `commands/search.ts:70`, `intake-job.tsx:5`,
  `wakeup/command.ts:10`, `feedback.tsx:8`, `briefing.tsx:144`. Glossary:
  one line separating `origin` from `via.channel`.
- **Why.** Agents must not be told to create memos.

### Track D — migration `retire-memo-2026-10`

A pure planner turns the box's memos into a list of file operations; a runner
applies them; a verify phase re-scans. Shape copied from
`src/scripts/migrate/briefing-openers/`.

- **Inventory.** Every `*.memo.card` outside `_config/_template-updates/`.
  Its recording is either inside its attach scope (quick capture's layout,
  `source.ts:127-131`) or a same-basename sibling such as `Note.m4a` beside
  `Note.memo.card` (the pre-action's layout, `transcribe.ts:141-155`). More
  than one audio file for one memo is a planning error.
- **Per memo:**
  - **Title:** `title:` field if set; else a leading `# Heading` line
    (removed from the body); else the first non-empty line of body or
    `transcription.text`, markdown markers stripped, cut at 80 characters
    (`truncateTitle`); else the humanised filename.
  - **Dropped:** `status`; `created` except as the audio card's `via.at`;
    `transcription.language`, `transcription.transcribed-at`, and a
    `transcription-error` with no recording. Each drop is printed with the
    card path and value (boxholder, 2026-10-16).
  - **`source`** → `via: {channel: <value>}`. **`context`**: `url` →
    `sources: [{href, label?: title}]`; a `title` with no `url` and the
    `text` go into the body as in Track B.
  - **Recording:** `<stem>.audio.card` in the doc's attach scope; the file
    moves to `<stem>.attach/<file>` with `movePathPreservingAnnexSymlink`
    (sibling recordings move into the attach scope first). `via: {channel:
    "microphone", at: created}`; `transcription.text` → `transcript`;
    `transcription-error` copied. Body links to the old file become links
    to the audio card; when the body had none, a link is appended.
  - **Transcription with no recording:** text becomes the body when the body
    is empty, else appended under `## Transcript` unless the body already
    contains it.
  - Keeps `share-id` and every global field (`title`, `todos`, `theme`,
    `prominence`, `symbol`, `contains`, `contains-evidence`). Any other
    top-level or nested field is a planning error naming path and field.
- **References.** The doc keeps the memo's directory and basename, so the
  planner replaces each exact memo filename (`<base>.memo.card` →
  `<base>.doc.card`) in every card and `.md` file, the new docs included.
  This catches every form a mention takes: relative and absolute links,
  frontmatter refs, inline YAML maps the resolver-based rewriter skips
  (`src/core/rewrite-card-refs/core.ts:29-31`), and prose. A recording in an
  attach scope keeps its `<base>.attach/` prefix, so mentions of
  `<base>.attach/<file>` gain the new folder the same way. A sibling
  recording's bare filename cannot be told apart from prose; a remaining
  mention of it is a planning error naming the file. Nothing is written
  when planning fails. (Implementation note, 2026-10-16: this replaced the
  path-map-plus-resolver design the plan review examined; it is simpler and
  covers more reference forms.)
- **Retry.** Every write is atomic (`writeFileAtomic`). The runner writes in this order per memo: audio card, recording
  move, doc, referrer rewrites, memo delete. The planner recognises each
  partial state and continues from it: a recording already at its new path
  with an audio card that matches the plan; a doc that matches what the plan
  would write. A doc that exists and differs is a planning error. The
  migration runner's snapshot keeps the before-state
  (`docs/cards/migrations.md:95-110`).
- **Box code preflight.** Text scan of the box's `src/` and `_config/`
  executable files (`.ts`, `.tsx`, `.js`, `.mjs`, `.json`) for `memo.card` or
  `"memo"`. Each match is printed as a warning; conversion proceeds
  (boxholder, 2026-10-16).
- Register at the end of `MIGRATIONS` (`src/core/migrations.ts`); the old
  `memo` entry (`:68`) stays RETIRED.
- Generated box docs: confirm `.claude/rules/card-memo.md` disappears on the
  next generate (prune at `box-docs.ts:24-27`).
- File `issues/deferred/` cleanup for the legacy guard in Track B, with an
  `activate-on` date.

### Track E — test fixtures

Mechanical: `.memo.card` fixtures become `.doc.card` with `title:`; tests of
memo behavior are deleted. Scripted where the fixture is plain frontmatter;
by hand where a test asserts memo-specific output.

## Could this be simpler?

Simplest: rename `*.memo.card` → `*.doc.card` with a title, leave the
recording and `transcription` fields on the doc. Fails on the boxholder's
2026-10-16 decision (voice data on an audio card) and keeps voice-only fields
on every doc. Second simplest: skip the audio-file move, point the audio card's
`filename.ref` at the sibling file. Fails because `filename.ref` is
`attach/…`-relative to the audio card's own scope. The plan adds no new
abstraction; Track D is the only new module.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A memo field the migration does not map | planned (planner doctest) | planning error, nothing written | clear |
| Run interrupted after moving a recording | planned (retry doctest) | planner resumes from partial state | clear |
| Annexed recording link breaks after move | planned (annex fixture) | `movePathPreservingAnnexSymlink` | clear (verify checks links) |
| `.doc.card` target exists with different content | planned | planning error | clear |
| Reference form the rewriter misses | planned (inline-YAML fixture) | residual old-path scan → planning error | clear |
| Sibling-layout recording left behind | planned | inventory covers both layouts | clear |
| Box code selects `*.memo.card` | planned | preflight warning | clear in migration output; the view itself goes empty |
| Migration failed; quick capture reconciles a memo source | planned | `migration-pending` error, no tombstone | clear |
| Filing chat moves the doc during transcription | planned (delayed provider) | re-resolve under lock | clear |
| Card write fails after transcription | planned | transcript recorded only after write | clear (retry) |
| Doc moved between re-resolution and the transcript write | no | the write does not recreate the moved folder (`writeFileAtomic` `createDir: false`), so it fails; the transcript is not marked recorded, and the next attempt re-resolves | clear (self-heals on retry) |

## Agent-flow / user-flow edge cases

- **Wrong type:** agent creates `.memo.card` from old box prose — ADDRESSED:
  parse error carries the retired-type hint (Track A).
- **Stale ref:** ADDRESSED in Track D (path map, residual scan).
- **Two agents:** quick-capture writes take the doc's card lock
  (`source.ts:105`); the transcription write re-resolves under that lock.
  ADDRESSED.
- **Hand-edit drift:** `via` without `channel` fails validation with a Zod
  message. ADDRESSED.
- **Fabricated value:** the placeholder title is plain and honest. ADDRESSED.
- **Partial migration:** ADDRESSED by the retry rules in Track D and the
  runner's snapshot.

## NOT in scope

- Retitling unfiled captures automatically: boxholder chose placeholder plus
  agent retitle.
- Rewriting box-authored prose (guides, procedures) that mentions memo:
  judgment on box content; the parse hint covers creation attempts.
- Converging emission `origin` values with `via.channel`: different concepts
  (glossary line records the rule).
- Feedback's own transcription fields: unchanged.

## Open design questions

None. Six decisions were settled with the boxholder on 2026-10-16: voice
shape, voice title, migrated titles, provenance, dropped transcription
metadata, box-code warnings.

## Knowledge audits

One `knows_directly` entry: "a captured voice note is a doc whose recording,
transcript and error are on an audio card in its attach scope". Run against
the worktree's test1 clone.

## What will hold this after it ships

- Doctest for the migration's pure planner (title chain, field map, both
  recording layouts, residual-reference scan, partial states, abort cases)
  — the risky decisions as a pure function.
- Doctest running the migration on a temp box with an annexed recording.
- Updated quick-capture doctests (`test/core/quick-capture/*`,
  `test/webapp/routes/quick-capture.doctest.md`).

## Implementation order

1. Track A schema (doc fields; memo still present).
2. Track B quick capture.
3. Track D migration with doctests; dry-run then apply on the worktree's
   test1 clone.
4. Track C guidance and pre-action.
5. Remove memo (Track A rest) and Track E fixtures together.
6. Docs; knowledge audit; cross-model code review.

## Rollout shape

Done when the change-selected tests, `bbx validate` on the migrated test1
clone, and the migration verify phase all pass. The migration is a script
that resumes from any partial state, run by the deploy's
`bbx engine migrate --sweep`.
