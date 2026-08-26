---
title: "Renaming a chat husk (which we encourage) silently creates a duplicate on re-backfill"
workstream: chat-session-identity
area: callback-box
filed-by: agent
discovered-in: worktree-compacting — while eval'ing chat review against real boxes
---

> **Checked 2026-08-26 — narrower still.** `session/state.ts:158`
> (`captureAssignedSessionId`) returns early while a session is current, so a
> plain resume no longer reaches `ensureChatHusk`. The path stays open on the
> first resume after a server restart (no current session → `onAssigned` →
> `ensureChatHusk` → suffix miss → duplicate) and on a coined chat's first run.
> Fix is Track 1 of
> [chat-session-identity](../../callback-box/docs/plans/chat-session-identity.md):
> lookup by the `session` field, plus the duplicate-`session` lint rule.

> **Checked 2026-08-14 — partly fixed, one recurrence path left.** Tagged
> `fixed`; the tag was half right, so it is removed and the issue stays open
> with the remainder narrowed.
>
> **Closed:** the backfill path. `b7ca3a64` replaced the one-shot marker-gated
> `backfillChatHusks` with `reconcileChatHusks`, which runs every boot and keys
> off `listChatHusks` session data rather than filenames. `ac8e12c5` made
> `findChatHuskEntry` fall back to a session-field scan, so read paths tolerate
> a renamed husk.
>
> **Still live:** `ensureChatHusk` (`callback-box/src/core/chat/husk.ts:84-104`)
> still gates idempotency on the filename-suffix check in `findChatHusk`
> (lines 46-57), unchanged. The session-resume path
> (`registry.ts:181-199,256-286` → `husk.ts:280`) calls `ensureChatHusk` on
> every resume, so a husk renamed past its `_<shortid>` suffix still gets
> duplicated the next time its session resumes — after a server restart, for
> instance. And the validation the original doc comment leaned on to make this
> "discoverable rather than harmful" still does not exist: `src/schemas/chat.ts:18`
> has `session` as a bare `z.string()` with no uniqueness check in card lint.
>
> Traced statically end to end; no run needed to confirm the path exists.

`findChatHusk` (`callback-box/src/core/chat/husk.ts:42`) locates a session's husk
by the `_<shortid>.chat.card` **filename suffix**. Its doc comment accepts that a
fully renamed husk won't be found, and argues the consequence is benign:

> a fully renamed husk is fine too — it just won't be found here, and ensure
> would create a duplicate pointer, which validation of the `session` field
> makes discoverable rather than harmful

**That validation does not exist.** Nothing in `card-lint.ts`, `schemas/chat.ts`,
or anywhere else checks that `session` is unique across husks — `session` is a
bare `z.string()`. So a duplicate is neither discoverable nor flagged; it is
simply two cards claiming the same conversation.

This matters because renaming is **actively encouraged**. `schemas/chat.ts:29`
tells agents: *"renaming the file is safe and encouraged once the topic is clear:
`cb mv` to a meaningful name."* So the documented happy path arms the bug.

## Why it's reachable, not theoretical

`backfillChatHusks` (`husk.ts:174`) is gated by a marker file at
`.callback-box/chat-husks-backfilled` — and `.callback-box/` is **gitignored**
(confirmed: `content/.gitignore:16`). So the marker is per-checkout, not per-box.
Any fresh clone of a box re-runs the backfill, and every husk renamed since
creation gets a second card created alongside it.

Fresh clones are routine here: worktree sessions clone the test box, and
`~/src/box-worktrees/<name>/` exists precisely to make per-worktree box clones.

A resumed session re-emitting `on-assigned` (`session/registry.ts:308`) is a
second, likelier-in-normal-use path to the same `ensureChatHusk` call.

## Not yet happening in the field

Checked every husk across `ai-class`, `personal`, `personal-test`, and
`box-family` on 2026-07-28: all filenames still carry their `_<shortid>` suffix,
so nobody has renamed one yet. The bug is armed, not fired.

## Knock-on for chat review

Two husks for one session interact badly with
[chat review](../../callback-box/docs/chat-review.md): its journal is keyed by
**session id**, but `review-span` lives on the **husk**. The first husk gets
reviewed and advances the journal; the second then resolves an empty span, falls
below the size threshold, and is never reviewed — so it sits there permanently
titled by whatever snippet it was born with, looking like a real chat.

## Options, unsettled

- **Stop matching on the filename.** Read `session` out of each card
  (`listChatHusks` already does exactly this) instead of pattern-matching
  names. Costs a directory read per `ensureChatHusk`; makes renaming genuinely
  safe, which is what the docs already promise.
- **Add the validation the comment claims** — a lint rule flagging two husks
  with the same `session`. Cheap, and it makes existing duplicates visible.
- **Commit the backfill marker** so it is per-box rather than per-checkout. Fixes
  the clone path only, not the resume path.

The first option seems right — it makes the documented behaviour true rather
than adding a check for a state we could avoid producing.
