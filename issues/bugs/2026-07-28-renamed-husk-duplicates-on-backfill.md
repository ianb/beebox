---
title: "Renaming a chat husk (which we encourage) silently creates a duplicate on re-backfill"
area: callback-box
filed-by: agent
discovered-in: worktree-compacting — while eval'ing chat review against real boxes
---

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
