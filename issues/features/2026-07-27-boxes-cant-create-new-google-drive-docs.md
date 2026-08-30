---
title: "Boxes can't create new Google Drive docs easily"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: main session — boxholder asked to file
needs: [design]
priority: important
---

A box can *edit* a Google Doc it already synced, but there's no easy path for a
box to **create a brand-new Drive doc** (e.g. draft a document from a chat and
drop it into the user's Drive). The Drive integration today is
sync-in + edit-existing, not create.

## What exists vs. what's missing

The `GoogleDriveService` interface (`beebox/src/services/google-drive-types.ts:90-126`)
is entirely keyed on an **existing** `fileId`:

- `getFile` / `listFiles` / `listSpreadsheets` / `getSpreadsheet` — read
- `getDocument` / `getSheetValues` / `exportFile` / `listComments` — read
- `updateFileContent(fileId, …)` / `updateSheetValues(fileId, …)` — edit an
  existing file

There is **no** `createFile` / `documents.create` / `files.create` — nothing
that mints a new Drive object. The connector
(`beebox/src/connectors/google-drive.ts`) syncs Drive → box and pushes
edits back (`created`/`updated`/`pushed` all describe *synced* folder contents,
`google-drive.ts:173-185`), so "created" there means "newly seen in the mounted
folder," not "created by the box."

Net: to produce a new Google Doc a box would have to already have an empty doc
synced and overwrite it — there's no first-class "make me a new doc" action.

## Why the resolution isn't obvious (needs design)

Creating the file is the easy half (Drive `files.create` /
`documents.batchUpdate`). The open questions are the box-side lifecycle:

- **Where does the new doc land in Drive?** A configured mount folder, a
  fixed "box output" folder, or user-specified per call? Mounts are configured
  in `config/connectors/*.json` today.
- **How does it come back as a card?** A newly created Drive doc should
  round-trip into a synced doc-card so the box can keep editing it — i.e.
  create must hand off to the same sync path that inbound files use, not be a
  fire-and-forget write. Pre-minting the card and reconciling the returned
  `fileId` needs thought (state lives in `config/connectors/*.state.json`,
  written by two processes — see `google-drive-state.ts`).
- **What's the agent surface?** A `bbx` command, a connector action, or a tool
  the box agent calls mid-chat. This determines how naturally "draft this and
  put it in my Drive" works from a conversation.
- **Doc vs. Sheet vs. plain file** — start with Docs (the common ask) or make
  the create generic over Drive types?

## Related

- [Drive mounting / file-browsing UI](../closed/features/2026-06-26-drive-mounting-file-browsing-ui.md)
  — same integration, the browse/mount side.
- [Agent emits bare card filenames in chat](../closed/bugs/2026-07-21-agent-emits-bare-card-filenames-in-chat.md)
  — the synced-doc card type is the most exposed surface; a create flow adds
  another place the agent references these cards.
