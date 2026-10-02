---
title: "Standard card fields: ban status and created, reserve source, group source metadata"
status: implemented
workstream: card-fields-review
issues:
  - ../../../issues/closed/code-quality/2026-09-27-review-standard-card-fields.md
---
# Standard card fields

Card schemas share a small set of field names. Some are declared globally
(`GLOBAL_CARD_FIELDS`), and others (`status`, `created`, `source`, `date`,
`summary`) are repeated per type with different meanings. Agents fill these
fields in because they look standard. Readers expect them to mean something,
and often nothing reads them. This plan decides the standard set, removes or
renames the rest, and makes the schema API reject the names that attract bad
fields.

**Issues addressed:**
[review the standard card fields](../../../issues/closed/code-quality/2026-09-27-review-standard-card-fields.md).
Related, not resolved here:
[retire memo](../../../issues/code-quality/2026-09-27-retire-memo-card-type-into-doc.md)
(owns memo's `status`, `created`, `source`, and its body-derived title),
[codebase ontology files](../../../issues/docs-and-chores/2026-09-27-codebase-ontology-files.md)
(a name with two meanings is a collision; this plan removes several),
[card Properties design session](../../../issues/features/2026-09-27-card-properties-design-session.md)
(owns what the Properties panel shows; this plan only removes `created` and
`source` from it).

## Decisions from the review (boxholder, 2026-09-28)

These were settled in discussion and are the plan's premises.

- **`status` is banned.** It is a name that invites bad fields. Each current
  use is removed or replaced by a specific key. Usually the replacement is the
  presence of the thing itself (a transcript) or an error field.
- **`created` is banned.** A creation time is valid only for media that
  existed before the card, and that time already lives on the media
  reference (today `filename.captured`; `filename.via.at` after Track D). Git records when a card was written.
- **`source` keeps the `{% source %}` meaning only**: what this content was
  derived from. Every other `source` field gets a name for what it holds.
- **Data copied verbatim from an external system** (email headers, Drive
  metadata, EXIF) lives under one key that names the external system, so it
  reads as source metadata and not as a box-level fact.
- **`date` and `modified` go**, except as source metadata under that key.
- **`contains` is not overloaded further.** It keeps its one meaning: one
  sentence stating what can be found inside the card. No field is folded into
  it.
- **`summary` goes.** `description` stays, with one defined meaning. A type
  may specialize that meaning, but this is discouraged.
- **`title` stays optional.** The boxholder does not want to require it.
- **Schema shadowing is rejected in code**, where it can be detected; the rest
  goes in instructions.
- **Every pointer is `{ ref }` or `{ href }`.** A field that names a card, a
  file, or a URL never holds a bare string.
- **Box-local schemas get fixed as a follow-up**, and that migration is an
  experiment in agent-applied migrations.

## Smallest fix and budget

**Smallest fix:** delete the dead fields (memo/file/pub-submission/job
`status`, `pub-submission.created`, `audio.summary`, observation `date`),
remove `created` and `source` from the Properties panel, and add the
reserved-name rule to `docs/cards/schemas.md`. That stops the worst filler
and costs perhaps 400 lines. It leaves `status` on about 15 types where code
reads it, `source` with six meanings, and nothing stopping the next schema
from adding a `status`.

**Chosen design:** six tracks (below).

| Track | Source + test lines (est.) |
|---|---|
| A. Reserved names and the shadowing guard | 250 |
| B. `status` removal, per type | 1,800 |
| C. `source` split and `sources` shape | 700 |
| D. Timestamps and source-metadata keys | 900 |
| E. `summary`, `description` | 150 |
| F. One title resolver | 300 |
| Migrations (scripts + doctests) | 1,200 |
| **Total** | **~5,200** |

Docs (schemas.md, bbx-guide-schemas, box-docs, agent guide) are about 400
more lines, not counted above. Generated box-docs change with them.

> **BIG CHANGE**, approved by the boxholder on 2026-09-28. About 5,200 changed lines. The size comes from the number of
> types (about 25 schemas lose `status`) and from each one needing a reader
> change, a migration, and test updates. It needs the boxholder's approval at
> this size. See *Open design questions* for splitting it into three plans that
> ship separately.

What the full design buys over the smallest fix: the check in Track A is
what stops the pattern from returning. Without it, a schema written next
month adds `status: new` again. Box-local schemas on prod copy the built-in
ones (see *What already exists*), so leaving `status` on any built-in type
keeps teaching it.

## Stated preferences this plan trades against

- **Strict by default** (memory: bias toward strict): a built-in schema with a
  reserved name fails the registry test; the plan does not settle for a lint
  warning there.
- **Consolidate over blast-radius fear**: one migration per concern across
  all types, instead of preserving drift for compatibility.
- **Minimize invented concepts; prefer primitives**: the replacement for most
  `status` values is the presence of an existing field (a transcript, an
  error), not a new enum.
- **Short compatibility horizon** (`.claude/skills/bbx-migration/SKILL.md`:
  *"Keep back-compat reads or dual-format loaders only for a short, explicit
  settling period"*). As built, there are no dual reads at all: deploy runs
  the migrations while each box is closed, before the new code serves
  (`docs/cards/migrations.md`, "Automatic convergence"), and a card the
  migration refuses keeps its old key for a person to fix.
- **Box-local schemas are box content.** The engine cannot rewrite them by
  script without judgment, so the guard must not break a box's load.

## What already exists

- **Global fields:** `beebox/src/cards/schema.ts:100-108`, injected by
  `cardSchema()` at `:531-536` with *"schema-wins: author declaration takes
  precedence"*. This precedence is what Track A removes.
- **Shadowing today:** `title` is redeclared by doc, gdoc, gsheet, recipe
  (required) and memo, pdf, webpage, commentary (optional, same as the global).
- **Lint for unknown keys:** `src/core/card-lint/core.ts:395` builds the
  allowed-key set from `schema.globalFieldNames` and the schema's fields. Reuse
  it for the settling-period warnings.
- **Migration harness:** `src/scripts/migrate/_harness.ts`, runbook
  `docs/cards/migrations.md`. Reuse.
- **Media references already carry capture time and channel:**
  `filename: {ref, captured, source}` on image (`src/schemas/image/schema.tsx:41-42`),
  file (`file.tsx:24`), pdf (`pdf.ts:43`); audio uses `recorded`
  (`audio.tsx:25`). Track D builds on this; it does not add a new place.
- **`{% source %}` shape:** `record.sources` is an array of
  `{ref|href, time?, note?}`, and `record.tsx:20-24` says it deliberately
  mirrors the tag. Track C adopts this shape.
- **Properties panel:** `CardFacts` (`src/frontend/src/components/themes/ThemedFileCard/CardProperties.tsx:12-23`)
  shows `fm.created` and `fm.source` for any card type. This is the only
  generic reader of either name.
- **Search `created`:** stored per document (`src/core/search/extract/core.ts:132`,
  `store.ts:52`), never filtered, sorted, or shown.
- **Box-local schemas on prod copy the built-in patterns.** A structural scan
  on 2026-09-28 found box-local `status` on 10 schemas across four boxes, and
  `name`/`description` on most box-local schemas.

## Prior art (external)

No design decision depends on an external premise. The source-metadata key
follows the existing `exif` field on image (`image/schema.tsx:51`), which
already holds camera metadata under the name of its origin.

## Ontology

- **Global field** — a frontmatter field every card type accepts, declared once
  in `GLOBAL_CARD_FIELDS`. Kept: `title`, `contains`, `todos`, `symbol`,
  `prominence`, `theme`. `contains-evidence` also stays global (see Track E).
- **Reserved name** — a field name no schema may declare: every global field
  name, plus the banned names `status`, `created`, `summary`, `date`,
  `modified`. `source` is reserved too; the derived-from field is `sources`.
- **`sources`** — what this card's content was derived from. An array of
  `{ ref } | { href }` entries. Same meaning as the `{% source %}` tag
  (`src/shared/markdoc-config/tags/core.ts:163-190`). Where an entry attribute
  means what a tag attribute means, it uses the tag's name: `retrieved`,
  `usage`. Two attributes exist only in frontmatter: `label` (display text,
  from recipe) and `note`. record's `time` becomes `pos`: its values are
  moments in a transcript ("at 1:23"), the tag's locator, not a retrieval date.
  Not a producer, a channel, or a basis.
- **Pointer** — `{ ref }` for a box path, `{ href }` for a URL. Every field
  that points somewhere uses one of these two shapes, never a bare string.
- **Media reference** — the `filename:` object that points at a card's
  attached media: `{ ref, via }`.
- **`via`** — how the media came to be in the box. An object:
  `{ channel, at, original?, note? }`. `channel` is the capture channel (was
  `filename.source`: `microphone`, `camera-user`, `gallery`, `scan-import`, …).
  `at` is the time the media was acquired (was `filename.captured`, and
  `filename.recorded` on audio). `original` is the date of the original, when
  it is known and differs from `at` (a scanned 1970s photo). `note` says how or
  why, in prose. `via.at` replaces `created` everywhere a creation time is
  valid: a transcript or an analysis points at its media and inherits the
  time, it does not copy it.
- **Date entry** — a structured date, exported from `beebox/cards` as a shared
  Zod type so built-in and box-local schemas use one shape:
  `{ value, kind?, end?, note? }`. `value` is ISO 8601 at whatever precision is
  known (`1974`, `2026-09`, `2026-09-28`, or a datetime with offset). `end`
  makes it a range. `kind` says which date it is when a card has several
  (`due`, `filed`, `starts`). `note` is prose. A card with one date names the
  field for it (`due: { value }`); a card with several uses `dates: [...]` with
  `kind`. record's existing `dates: [{ value, note? }]`
  (`src/schemas/record.tsx:43-46`) is already this shape without `kind` and
  `end`. The date entry is for dates that belong to the subject; it is never
  when the card was written.
- **Source-metadata key** — one object field named for the external system,
  holding data copied verbatim from it: `email:` (headers), `drive:` (Drive
  file metadata), `exif:` (camera). It is not box-authored and not edited by
  agents.
- **`description`** — what the card's subject is or does, in prose, for
  someone who has not opened it. Not a summary of the card's contents; that
  is `contains`.
- **`contains`** — unchanged: one sentence stating what can be found inside
  the card, the retrieval field.

## Tracks / scope

### Track A — Reserved names and the shadowing guard

**What.** Built-in schemas may not declare a reserved field name; box-local
schemas are warned. The one allowed redeclaration makes `title` required.

**Why.** Today a schema can redeclare a global and win silently
(`schema.ts:533`), and any schema can add `status` or `created`. Instructions
alone have not stopped this: box-local schemas repeat it.

**Direction** (as built in part 1).
- `reservedFieldProblems(schema)` in `src/cards/reserved-fields.ts` reports
  each top-level field that is a global name or a banned name (`status`,
  `created`, `summary`, `date`, `modified`, `source`), with a message saying
  what to write instead. Nested keys are covered by Track B case by case.
- `cardSchema()` does not throw on it: box-local schemas call the same
  `cardSchema()` and are dynamically imported (`src/schemas.ts:357`), where a
  throw becomes an import failure and the schema is skipped.
- **Built-in schemas:** `test/cards/reserved-fields.doctest.md` runs the check
  over the registry. Uses that parts 2 and 3 still remove are listed there;
  the list only shrinks (the test fails on an entry that no longer exists).
- **Box-local schemas:** the `box-schema-fields` health check reports each
  problem as a warning. The schema still loads.
- **Required title:** a schema may declare `title: z.string()` (required). An
  optional redeclaration is reported. doc, gdoc, gsheet, recipe keep their
  required title; webpage and commentary drop their redundant optional one.
  A config flag was tried and dropped: it lost the required type in
  `InferCardFields`.
- `title` leads every card's frontmatter (parse order is serialization
  order), declared or not.

**Vocabulary lock-ins.** `reservedFieldProblems`, `box-schema-fields`.

### Track B — Remove `status`

**What.** Every card-level `status` is removed or replaced by a specific field.

**Why.** Of about 25 types, the review found `status` dead on four (memo,
file, pub-submission, progress entries used for a different meaning),
constant on six (all job cards, gsheet), and reset by the connector on
email-thread. Where it works, it is a generic name for a specific fact.

**Direction** (per type; evidence from the 2026-09-28 audit):

| Type | Today | Replacement |
|---|---|---|
| memo | never leaves `new`, no reader | removed (memo retirement issue owns the type) |
| file | never leaves `new`, no reader | removed |
| pub-submission | never leaves `new`, no reader | removed |
| record | `draft`/`reviewed`/`archived`; template writes `draft`; no code reader (on one real box, 571 of 578 are `draft`) | removed; `reviewed: true` and `archived: true` where set |
| email-thread | template writes `new`; re-fetch resets it; no reader | removed |
| chat-job, intake-job, contains-backfill-job, question-followup-job, todo-review-job | only `pending` is written; a finished job is deleted (`src/core/finish-job.ts`) | removed; readers treat an existing job card as pending |
| gsheet | always `synced` | removed |
| email-outbound | `sent` never written; drafts code uploads `draft` cards without a draft id (`src/connectors/gmail/drafts/core.ts:146`) | removed; presence of `gmail-draft-id` is the gate |
| audio | `transcribed` set by `transcribe-clips.ts:121` | removed; presence of `transcript` means done, `transcription-error` means failed |
| pdf | `new`/`analyzed`/`invalid`, moved by scan import and reanalyze | removed; `docling` present means extracted; the existing `error` field records failure; an agent's `invalid` becomes `unusable: true` (built) |
| image | `analyzed` set by scan import; `invalid` never written by code but skipped by the timeline (`src/core/capture/prepare/timeline.ts:146`) | removed; `description` present means analyzed; an agent's `invalid` becomes `unusable: true`, which the timeline skips (built) |
| telegram-message | `pending`/`failed`; the card is deleted on success | removed; `delivery-error` means failed, absence means pending |
| capture-session, upload-batch | `new` → `delivered` by intake; sweeps read `delivered` | `delivered: true`; the agent's `annotated` becomes `annotated: true` |
| browser-task | `open`/`closed`, toggled by the user | `closed: true` |
| tab-arrangement | `draft`/`ready`, agent sets `ready`, gates Apply | `ready: true` |
| person, place | `active`/`inactive`/`archived`; readers skip non-active | `archived: true` (inactive merges into archived) |
| gdoc | `synced`/`conflict`, recomputed on every pull (`src/connectors/google-drive/handlers/docs/handler.ts:300-307`); `conflict` is an unresolved state the frontend shows (`src/frontend/src/lib/drive-card-display.ts:43`) | `conflict: true`; absent means in sync. This is connector state, so it stays out of the `drive:` source-metadata key |
| gfolder | `ok`/`error`, stamped with `last-sync` (`src/connectors/google-drive/card-stamp.ts:52-57`) | removed; the existing `error` field means the last sync failed (built) |
| question | `pending`/`answered`/`dismissed`/`expired`, real transitions | removed; state is derived by `questionState()` from which of `answered-at` / `dismissed-at` / `expired-at` is present (built) |
| procedure-run | a checked state machine (`run-card.ts:111-149`) | `outcome: completed \| failed \| inconclusive`; no `outcome` means running or interrupted (the engine never wrote `pending`) (built) |
| guide/personality experiments | `proposed`/`active`/`successful`/`unsuccessful`/`mixed`/`inconclusive`: a stage and a result in one field; agent-moved; compile keeps `active`/`proposed` (`guide/compile.tsx:64`, `personality/compile.ts:90`) | `active: true` while running; `outcome: successful \| unsuccessful \| mixed \| inconclusive` once concluded; neither means proposed |
| lesson-plan segment | `planned`/`ready`; lint skips `planned` | `planned: true` |
| progress entries | learner mastery (`partial`, `solid`), not a lifecycle | renamed `level` |

`todo-view.status` is a filter over todo statuses, read by the view
(`src/frontend/src/components/todo-view-card-logic.ts:43`), not card state.
It is renamed `todo-status` so the reserved-name check can cover it.

**Generic `status` readers go too.** The Browse listing loads `status` from
every card (`src/webapp/routes/api/register/browse.ts:134`) and puts it in
the sidebar entry's label (`BrowseSidebarList.tsx:106`) and the directory
accordion (`src/frontend/src/directory-listing.tsx:47`). This is a generic UI
reader that rewards any type for having `status`; it is removed. The view
authoring doc's example that filters on `frontmatter.status`
(`src/core/views/doc/core.ts:146`) is rewritten to use a specific field.

Nested step statuses inside procedure-run (`steps[].status`, precheck and
validate results) are result values of a run record, read by the engine. They
are not card state and are left alone.

**Vocabulary lock-ins.** `outcome` (question, procedure-run); `delivered`,
`annotated`, `closed`, `ready`, `archived`, `planned` booleans;
`transcription-error`, `analysis-error`, `delivery-error`; `level`.

**First chunk.** The dead and constant cases (memo excepted): file,
pub-submission, email-thread, job cards, gsheet, email-outbound. Schema
removal, reader changes, one migration that strips the field, tests. No open
questions.

### Track C — Split `source`

**What.** `source` keeps only the derived-from meaning, as `sources`. Every
other `source` gets its own name.

**Why.** `source` has six meanings today, and the Properties panel shows all
of them under one label.

**Direction.**

| Type | Meaning today | New field |
|---|---|---|
| webpage | original page URL (required string); written by the clerk (`src/webapp/trpc/routers/clerk.ts:177-185`) and the share router (`share/router.ts:50-57`) | `sources: [{ href, retrieved }]`, required, one entry; `retrieved` is the capture instant, which replaces `captured` (built) |
| recipe | `{label, href, ref}` | `sources: [...]`; an entry may be a `label` alone (a cookbook, a person) (built) |
| record | already `sources` | entry `time` becomes `pos` (built) |
| commentary | the annotated page URL | `about: { href }`; the commentary annotates the page, it is not derived from it (built) |
| contains-backfill-job, question-followup-job, todo-review-job | a constant: each type has exactly one producer; backfill uses it to avoid queuing a second job (`src/cli/commands/wakeup/steps.ts:384,436`) | removed; that check looks up pending jobs by type instead (built) |
| chat-job, intake-job | which connector or step created the job; also a routing and dedup key (`src/core/reactor/job-discovery.ts:99`, `src/job-cards/intake-utils.ts:121`) | `connector: <name>` when a connector-scoped run made the job; absent otherwise (see *Job routing* below) (built) |
| media references (image, file, pdf, audio) | capture channel | `filename.via.channel` |
| feedback | `text` \| `voice` | `via: { channel }` |
| guide, personality | belief basis (`user-stated`, `inferred`, …) | `basis` (built) |
| browser-task | URL where scanning starts | `start: { href }` (built) |
| capture-session | the uploader token name | `uploader` (built) |
| scheduled-script | why the schedule exists | `reason` (built) |
| tab-arrangement | the captured tabs before rearranging | `captured-tabs` (built) |
| image `text[].source` | the surface the text is printed on | `surface` (built) |
| memo | capture channel | removed with memo |

`CardFacts` stops showing `source`. Frontend readers that change with it:
`WebpageView.tsx:27` (`source` → `sources`), `RecipeView.tsx:31`,
`BrowserTaskView.tsx:172` (reads `status` and `source`),
`TabArrangementView.tsx:257`, `PdfCardView` via `src/frontend/src/lib/pdf-card.ts:142`
(`filename.source` → `filename.via.channel`), and `src/core/triage/snapshot.ts:75`
(guide `source` → `basis` in the compiled policy text).

**Job routing.** Today a job's `source` string is also its routing key: a
connector-scoped wakeup drains only jobs whose `source` is that connector
(`src/core/reactor/job-discovery.ts:86-99`, `src/core/reactor/engine/core.ts:50-56`),
and intake appends to a pending job with the same `source`
(`src/job-cards/intake-utils.ts:114-123`). The values are the connector name
on scoped runs, and `wakeup` / `wakeup-captures` on full runs, where the pair
only repeats the job's `priority` (`src/cli/commands/wakeup/steps.ts:227-249`);
scan intake uses `scan` (`src/core/commands/scan-import/session-discard.ts:92`).
The replacement is `connector: <name>`, a name and not a pointer: a connector
has no single box file to point at (its configuration is split across
`_config/connectors/` files or lives in `box.json`). The routing filter
compares `connector`; the intake batching key becomes `(connector, priority)`.
A scan intake job has no connector and joins the unscoped normal-priority
job; intake already rewrites the description when it appends
(`intake-utils.ts:154`). chat-job's `telegram` becomes `connector: telegram`.
Decided by the boxholder's delegation, 2026-09-28.

**Vocabulary lock-ins.** `sources`, `via`, `connector`, `basis`, `start`,
`about`, `uploader`, `reason`, `captured-tabs`, `surface`.

**First chunk.** Remove `source` from the three single-producer job types, and
convert webpage, recipe and browser-task to pointer objects. The `producer`
target question is settled before the chat-job and intake-job chunk.

### Track D — Timestamps and source-metadata keys

**What.** Remove `created`, `date`, `modified` as card fields. External
metadata moves under a key named for its system.

**Why.** `created` is written from the clock at card creation
(`memo.ts:111`, `pub-submission` via `getBoxTime`), which git already records.
`date` and `modified` read as box facts but are copied from external systems.

**Direction.**
- `pub-submission.created` removed; `submitted-at` already holds the external
  event time.
- Guide/personality observation `date` removed (free text, no reader).
- Media references take the `via` object: `filename.captured` and
  `filename.source` (and audio's `filename.recorded`) fold into
  `filename.via.at` and `filename.via.channel`. Writers: capture
  (`src/core/capture/prepare/write-cards.ts:105-109,142-146`), scan import
  (`src/core/commands/scan-import/cards.ts:110-114`, `session.ts:75-84`,
  `pdf.ts:111-143`), and scan promote (`src/core/scan/promote/core.ts:98`).
  Readers: the capture timeline orders media by `filename.recorded` and
  `filename.captured` (`src/core/capture/prepare/timeline.ts:99-120,140-150`)
  and session time (`write-cards.ts:203`).
- **`email:`** on email-message holds the header data: `message-id`,
  `thread-id`, `from`, `to`, `cc`, `subject`, `received` (was `date`, which is
  Gmail's `internalDate`, the arrival time — `src/connectors/gmail/mime.ts:206-226`).
  email-thread's `thread-id`, `subject`, `participants`, `date-range`, `labels`
  move under `email:` the same way; `messages`, `body-file` and `attachments`
  stay top-level, and email-outbound stays flat (its headers are composed, not
  copied). A thread card the connector rewrites after migration is
  byte-identical to the migrated one, so it is not rewritten (built).
- **`drive:`** on gdoc, gsheet, gfolder, glink holds `id` (was `drive-id`),
  `link`, and per type `owner`, `modified` (Drive's `modifiedTime`), gdoc's
  `revision` and glink's `mime`. gfolder's and glink's `name` becomes the
  global `title` (glink declares it required, as `name` was). Sync state is
  not here: `title`, `conflict`, `error`, `last-sync` and the problem counts
  stay top-level. `bbx drive status` prints `drive.modified` as "Modified on
  Drive" and `last-sync` as "Last synced" (built).
- commentary's `captured` (the annotated page's capture date) becomes
  `about.retrieved`, the `sources` entry's name (built).
- `CardFacts` stops showing `created`. The search index drops its `created`
  column.
- memo's `created` goes with the memo retirement.

The date entry type (Ontology) ships in this track, exported from
`beebox/cards` (`DateEntrySchema`, `src/cards/date-entry.ts`); `value` and
`end` are checked as ISO 8601 at any precision, a datetime needing an offset.
record's `dates` adopts it but keeps `value` free text: of 206 `value`s across
test1 and the local backups, 4 are not ISO 8601 (`1970s` and other text), and
a transcribed date may not be one ISO 8601 can state. No built-in type other
than record has a domain date today, so its main users are box-local schemas
(follow-up) (built).

**Vocabulary lock-ins.** date entry `{ value, kind, end, note }`; `email`,
`drive` keys; `filename.via`
everywhere; `email.received`.

**First chunk.** The deletions: `pub-submission.created`, observation `date`,
search `created`, `CardFacts` created/source, the media-reference `via` object.

### Track E — `summary` and `description`

**Direction.**
- `audio.summary` removed; the transcriber (`transcribe-clips.ts:119`) stops
  writing it. Nothing reads it.
- `description` gets one written definition in `docs/cards/schemas.md` and the
  bbx-guide-schemas skill: *what the card's subject is or does, for someone who
  has not opened it.* Existing uses fit: an image's depiction, a procedure's,
  schedule's or job's purpose, a record's object, a recipe's blurb, a file's
  or PDF's subject. A type may narrow this in its own field doc.
- `contains-evidence` stays global. In practice only chat cards carry it, but
  `setDerivedContains` (`src/core/search/contains-update.ts:87-143`) writes it
  for any card through `bbx contains update`, and connector rewrites preserve
  it generically (`src/preserve-agent-fields.ts:15`).
- `contains` is unchanged. The existing search fallback from `description` to
  `contains` for image and file (`extract/core.ts:72-75`) is kept; changing it
  is out of scope.

### Track F — One title resolver

**What.** Search and listings resolve a card's title the same way.

**Why.** Listings use `title:`, else the type's `summarize`, else the file
name (`src/core/loader-registry.ts:31-46,97`). Search has its own per-type
fallbacks (`extract/core.ts:236-290`): email uses `subject`, person and record
use `name`. So an email thread lists under its file name but is found under
its subject. Separately, memo and image `summarize` replace an explicit
`title:` with body or description text.

**Direction.**
- Search takes its title from the card summary, not from its own fold.
- email-message, email-thread, person, record declare `summarize` to derive
  their title from `email.subject` or `name`.
- An explicit `title:` always wins in `summarize` (fix memo and image).
- `title` stays optional. No type becomes title-required beyond the four that
  already are.

## Could this be simpler?

The simplest version is the *Smallest fix* above: delete dead fields and write
the rule down. It fails on the case that started this review: the next schema
adds `status` or `created`, and the prod box-local schemas show that this
happens without a guard. Track A is what the rest depends on. Tracks B–D could
each be smaller by renaming `status` to type-specific names without
simplifying to presence fields; that keeps the same number of fields and the
same filler (`delivered: false`, `transcribed: false`) under new names. The
presence approach removes fields instead (principle: minimize invented
concepts).

## Subplans

None. If the plan is split (see *Open design questions*), each part becomes its
own plan, not a subplan.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A box-local schema declares `status`; if the check threw, the schema would be skipped at import | no | Track A: the check never throws; box-local problems are lint warnings | clear (warning) |
| A migration misses a card type that has the old field; the card loads with the old key stripped in memory and its meaning lost | no | unknown-key lint warning (`card-lint/core.ts:395`) | clear, but only if someone reads lint |
| The capture sweep reads `delivered: true` but an un-migrated session has `status: delivered`, so the sweep re-delivers it | migration doctests | the migration runs before new code serves | silent only for a card the migration refused (reported) |
| Job discovery filters by `connector` while an un-migrated job card has `source`; the job is never picked up | migration doctests | the migration runs before new code serves | as above |
| The share router's retry finds an existing webpage card by `share-id` and compares its exact text with a freshly generated card (`src/webapp/trpc/routers/share/router.ts:60-66,103-117`); a card written in the old `source:` shape no longer matches, so a retry reports a conflict | no | no | clear (conflict), but wrong; the migration must run before the new writer ships, or the comparison normalizes the shape |
| The Gmail connector rewrites an email card in the old flat shape because a code path still builds it | no | connector doctests | clear if the doctest checks shape |
| An agent writes `status:` by habit on a built-in type after migration | lint warns on the unknown key | yes | clear |
| Search title for email changes from subject to summary title; if `summarize` is missing, the title becomes the file name | no | Track F adds `summarize` to those types | silent |
| A stock template or seeded card changes shape (a procedure, a schedule default, a seeded person); boxes whose copy has no tracker entry park the update in `config/_template-updates/` instead of taking it (`src/core/install-template-file.ts:139,381`) | yes (tracker tests) | parking is the handling | silent to the boxholder unless someone checks parked updates |

> **Accepted risk:** no dual reads. A card is read in its old shape only if
> the migration refused it (an unmappable value), and a refusal is reported as
> a migration question. Deploy migrates before the new code serves.

## Agent-flow / user-flow edge cases

- **Wrong field:** an agent writes `status: done` on a doc. ADDRESSED: lint
  warns on the unknown key; the agent guide never mentions `status` after
  Track B.
- **Hand-edit drift:** the boxholder writes `source: https://…` on a recipe.
  ADDRESSED by lint (unknown key); the recipe doc shows `sources`.
- **Fabricated free-form value:** removing `status` removes the most common
  one (`status: new` forever). ADDRESSED.
- **Two agents on one card:** unchanged by this plan.
- **Partial migration:** ADDRESSED by migrating before serving; refusals are
  reported (Failure modes).
- **Box-local schemas:** DEFERRED to the follow-up below. Until it runs, the
  lint warning names the problem on each box.
- **Validation message UX:** each banned name's message says what to write
  instead (Track A).

## NOT in scope

- **Retiring memo.** Its own issue; this plan leaves memo's fields until then,
  except that memo stops being an exception to the guard only when it goes.
- **What Properties shows.** Its own design session; this plan only removes
  `created` and `source`.
- **Making `title` required.** The boxholder declined. The four types that
  already require it (doc, gdoc, gsheet, recipe) are left as they are; whether
  to relax them is a separate question.
- **`contains` adoption on bulk-ingested cards.** One real box has `contains`
  on 2% of 578 records and 0 of 271 PDFs; backfill queues 25 per wakeup.
  Worth an issue; not a field-design question.
- **Per-type `name` fields** (person, record, procedure, place). They work as
  data; Track F derives titles from them instead of renaming.
- **Migrating box-local schemas.** A follow-up; see *Follow-up: box-local
  schemas* below.
- **The `description` → `contains` search fallback.** Kept as is.
- **The `created` attribute on `{% todo %}` and frontmatter `todos` entries**
  (`src/core/todo/extract/body.ts:234`). It is per-todo, not a card field, and
  records when an intention was noted, which git cannot give per todo. Worth
  its own look; not covered by the card-field check.

## Open design questions

1. **Split into three plans?** The boxholder approved the size (2026-09-28).
   Lean: still ship in three parts, for review size, not scope. (1) Tracks A,
   E, F and the dead half of B. (2) The rest of B. (3) Tracks C and D, which
   touch the Gmail and Drive connectors. The banned-name list grows as each
   lands.


## Follow-up: box-local schemas

A separate plan, written after this one lands. It is also an experiment in
agent-applied migrations (`.claude/skills/bbx-migration/SKILL.md`: *"only when
the transform needs judgment on arbitrary box-authored code/prose"*).

**What is on the boxes** (structural scan of prod, 2026-09-28; no content):
- Four boxes have box-local schemas with reserved names: about 10 declare
  `status`, several declare `date`, two declare `source`, one declares both
  `source` and `sources`.
- On box-local types, `status` usually holds real domain data that the box's
  own views read: whether a collection item is owned or wanted, whether a bill
  is paid, whether an event is scheduled or a call is open. About 35 read
  sites in box views.
- Box-local `date` is usually a domain date (an announcement's date, a docket
  entry's date), read by views. The migration turns each into a date entry in
  a named field, not a removal.
- One box has a view that reads `created`, `source` and `status` from any card.

**Why agent-applied.** Each rename needs a name chosen from the meaning (the
owned/wanted state of a book is not the paid state of a bill), and the box's
views, schema and cards change together. A script cannot pick the names.

**Shape of the experiment.** Split per the skill's 80/20 rule. The agent reads
the lint warnings, the schema, and the views, and writes a rename map per
schema (old field → new field, value mapping). A script applies the map to
the cards. The agent edits the schema and the views. The gate is `bbx
validate` clean, every view renders, and the card count per type is
unchanged. Run it first on copies of the local backups, then on each prod box
with the boxholder reviewing the rename maps before the script applies them.
What the experiment measures: how often the agent's rename map needs a
boxholder correction, and whether the view edits hold.

## Knowledge audits

Two `knows_about` audits in `beebox/src/dev/knowledge-audits.yaml`, run on a
migrated copy of the worktree's test1 clone on 2026-09-29, both passing:
`schema-specific-fields` (a box-local schema author avoids reserved names and
names the specific fact) and `record-sources-provenance` (a record's origin
goes in `sources: [{ ref }]`). `knows_about` because box agents rarely author
schemas; they read the box schema doc when they do.

## What will hold this after it ships

- A unit test running `reservedFieldProblems` over the built-in registry, and
  one per banned name on a fixture schema.
- Per-type doctests already cover the readers that change (capture sweep,
  question transitions, procedure engine, Gmail and Drive connectors); each
  is updated in the track that changes its reader.
- Each migration gets the harness's dry-run test with a fixture per old shape.
- `bbx validate` on test1 after migration: zero unknown-key warnings.

## Implementation order

1. Track A (reserved-name check, required-title rule).
2. Track E, Track F.
3. Track B dead and constant cases, with the strip migration.
4. Track B live cases, one commit per type group, each with its migration.
5. Track D deletions, then `email:` and `drive:` keys with connector changes.
6. Track C: pointer conversions first, then `connector` on job cards.
7. Add each banned name to the guard as its last use is removed.
8. Docs: `docs/cards/schemas.md` rule, bbx-guide-schemas skill, box-docs and
   agent guide.
9. (No deferred cleanup: there are no dual reads.)

## Rollout shape

Stock templates whose fields change need their old stock hashes added to
`priorStockHashes`, so unmodified copies update in place instead of parking.
After prod rollout, check `config/_template-updates/` on each box.

Script migrations throughout (deterministic renames and strips), registered
append-only, run on dev boxes and then prod before the code that stops reading
old names. Done when: the registry test rejects every reserved name on built-in
schemas; `bbx validate` on test1 and each prod box reports no built-in card
with `status`, `created`, `date`, `modified`, `summary`, or `source`; the
changed doctests pass; the two knowledge audits pass.

## The rule for adding a field

For `docs/cards/schemas.md` and the bbx-guide-schemas skill:

1. **Name the consumer.** A new field names, in the same change, the query, UI
   surface, or code that reads it. A field nothing reads is not added.
2. **Reserved names are rejected.** Global field names, `status`, `created`,
   `summary`, `date`, `modified`, `source`. A test rejects them on built-in schemas;
   lint warns on box-local ones.
3. **State is the fact itself.** Record the result (`transcript`), the failure
   (`transcription-error`), or a specific boolean (`archived: true`), not a
   lifecycle enum.
4. **Times belong to media, external data, or the domain.** A capture time
   goes on the media reference (`filename.via.at`). Data copied from an
   external system goes under a key named for that system (`email:`,
   `drive:`, `exif:`). A date that is part of the subject (when an event
   happens, when a bill is due) is a date entry, `{ value, kind?, end?, note? }`,
   in a field named for it (`due`, `starts`) or in `dates: [...]` with `kind`
   when there are several. Never a bare `date` string. When the card was
   written is git's job.
7. **Pointers are `{ ref }` or `{ href }`.** Never a bare path or URL string.
5. **Don't do a global field's job.** No per-type title or summary field.
6. **`description` means what the subject is or does.** Narrow it for a type
   only when necessary.
