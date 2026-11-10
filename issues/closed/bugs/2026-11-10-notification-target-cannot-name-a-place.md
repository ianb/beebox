---
title: "A notification target cannot open a new chat in a place"
workstream: notification-place-target
area: beebox
labels: [notifications, landmarks, chat]
filed-by: agent
discovered-by: Ian
discovered-in: "main checkout — tapping a journal-nudge notification, 2026-11-10"
resolution: implemented
---

**Closed (implemented, 2026-11-10):** Resolved on worktree-notification-place-target (66efbbc99, 143ee5c84, 644ade433): chat:new:<dir> and place:<dir> targets, send-time check, tap fallback, iOS mirror, box-agent docs.

A box agent wrote a nightly "journal time" schedule that runs
`bbx notify --target chat:new`. A tap opened a new chat at the box root, not
in the journal place. The target grammar
(`beebox/src/core/notification/target.ts`: `chat:<sessionId>`, `chat:new`,
`card:<path>`, `question:<path>`, `admin:<section>`, `dashboard`) has no way to
name a place, and a `session=new` request resolves with an empty context
directory (`frontend/src/components/chat/everywhere/resolve-conversation.ts`).

Needed: a target for a new chat in a given place (for example
`chat:new:<place path>`), carried through the tap URL to the new chat's
context directory, listed in `bbx notify --help` and the generated scheduling
docs so a box agent writing a "go do X" nudge points it at X's place.
