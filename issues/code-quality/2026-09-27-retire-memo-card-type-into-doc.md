---
title: "Retire the memo card type: move what it holds into doc cards and their attachments"
workstream: unattached
priority: important
needs: [design]
area: beebox
labels: [cards, schema, migration]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder discussion, 2026-09-27
---

The memo card type (`beebox/src/schemas/memo.ts`) is often misused. It is
meant to be raw captured input, a text or voice note, but agents grow memos
into real documents and never change the type. Such a card then shows
`status: new` and a `created` time, and has no title. On one real box, a
captured memo was moved into a project folder and expanded into a talk draft
over several commits, while the other cards in that folder were `doc`
cards with titles.

The developer's direction: move anything useful from memo into `doc`, and
remove the memo type. Media stays beside the doc in its attachment scope
(`Name.attach/`), together with other files such as transcripts. Keeping
memo is possible but needs a discussion; the developer's tendency is to
remove it.

## What memo has today

- **Fields:** `status` (`new` | `processing` | `processed`), `created`
  (required), `source`, `context` (`url`, `title`, `text` of a browser
  clip), `transcription`, `transcription-error`, and the body.
- **`status` is dead.** No code moves a memo out of `new`. On one real box,
  16 of 17 memos say `new` and one says `processed`. Purge the field.
- **`created` gets misused.** The developer: a creation time belongs only
  where something is made later from an earlier piece of media, for example
  a transcription made from a recording. On a memo it records nothing that
  git history does not already show, and it looks like a general field.
  Do not carry `created` into `doc`.
- **The title comes from the body, with the markdown.** A memo has no
  title field; its displayed title is the start of the body
  (`src/schemas/memo.ts:82-95`), so a body that starts with `# Heading`
  shows as "# Heading". Only memo does this. The problem goes away with the
  type, but migrated cards need real titles (see below).
- **Transcription.** The transcribe pre-action runs on memo and feedback
  cards (`src/core/preactions/transcribe.ts:57`). Five memos on the same
  box are `source: voice`.

## What uses it

- Capture and intake create memos: the `memo` and `voice-memo` templates
  (`src/schemas/templates-builtins.ts:32-47`) and `buildMemoCard`
  (`src/schemas/memo.ts:103`).
- The publish-submissions connector writes access-log digests as memo cards
  (`src/connectors/publish-submissions.ts:230`). That is not captured input
  either and needs its own home.
- The doc schema's instructions send captured notes to memo
  (`src/schemas/doc.tsx:78`).
- About 25 source files mention the type: views, search, file-type
  renderers, migrations, and label code.

## What the design must decide

- **Voice capture as a doc.** A voice note becomes a doc whose recording
  and transcript live in its attachment scope. Decide where the
  transcription pre-action writes, where `transcription-error` goes, and
  what a voice doc's title is before and after transcription.
- **Titles for migrated cards.** `doc` requires a title. Decide how each
  existing memo gets one: an agent-written title, the first heading with the
  `#` removed, or the file name.
- **Provenance.** Whether `source` and `context` survive as doc fields, as
  attachment metadata, or not at all.
- **The access-log digest.** Which card type it becomes.
- **The migration.** Every box has memos (17 on the test1 clone). Use the
  bbx-migration skill. The migrated card must keep its attachments and its
  links.
- **Whether to keep memo at all.** Only if the discussion finds a job that
  a doc cannot do.

## Related

- [Review the standard card fields](2026-09-27-review-standard-card-fields.md):
  `created` and `status` are examples of fields that slip in.
- [A card field for when a card stops mattering](../features/2026-09-27-universal-moot-after-card-field.md).
