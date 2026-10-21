---
title: "Expanded chat activity lines say \"Made a change\" with no detail"
workstream: activity-detail
resolution: implemented
area: beebox
labels: [chat]
filed-by: agent
discovered-by: Ian
discovered-in: main session — 2026-10-15
---

Closed by 1271301ff (plan [activity-detail](../../../beebox/docs/implemented-plans/activity-detail.md)): expanded activity lines name the thing and show what changed. Divergence: Codex edits get names only, since Codex records no old/new text; failure detection relies on Claude Code's `<tool_use_error>` result prefix.

The plain-language rewrite of the chat activity row (closed
[activity row speaks in commands and files](../bugs/2026-10-08-chat-activity-row-speaks-in-commands-and-files.md))
also changed the expanded list. When the boxholder expands the row, a step
can read only "Made a change". The expanded list is the place where a person
asked for more, so it should say more than the collapsed summary does.

## What the boxholder asked for

When tool calls are expanded, show more detail, not just "made a change".

## Where the vague lines come from

`beebox/src/frontend/src/components/chat/ChatMessages/activity-wording.ts`,
`describeToolCall`:

- `Edit` and `Write` on a file that is not a card and not a schema return
  `verbs.other`, "Made a change", with no name (`describeFileTool`). A
  `.md` document, a text file, or a file under `_content/` all read the
  same.
- `Bash` without a `description` is "Took a step".
- `Grep` and `Glob` are "Searched your box" and "Looked through your box",
  with no search text.
- `Read` of a non-card file is "Checked something in your box".

Each line expands again to the raw input and result. Between the vague line
and the raw JSON there is no middle level.

## Open questions

- **What detail.** Candidates: the file's display name or title, the
  landmark it is in, the search text, the size of an edit (lines added and
  removed), and a short before/after excerpt for an edit.
- **Two levels or one.** Whether the collapsed summary stays lay ("made a
  change") while expanded lines name the thing, or whether expanded lines
  also show a small diff in place of the raw input.
- **Paths.** The earlier fix removed file paths on purpose. A title or
  display name from the card or document may be enough; a raw path such as
  `_content/...` should stay out of the line (see the `_content/` concern in
  [printable cards](2026-10-01-printable-cards.md)).

## Related

- [Codex bash activity shows its shell wrapper](../bugs/2026-08-30-codex-bash-activity-shows-shell-wrapper.md).
- [Surface agent error detail in chat](../../features/2026-07-11-surface-agent-error-detail-in-chat-ui.md).
