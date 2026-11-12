---
title: "A new chat opened from a notification offers an unrelated pending question"
workstream: notification-place-target
area: beebox
labels: [notifications, questions, chat]
filed-by: agent
discovered-by: Ian
discovered-in: "main checkout — tapping a journal-nudge notification, 2026-11-10"
resolution: implemented
---

**Closed (implemented, 2026-11-10):** Resolved on worktree-notification-place-target (66efbbc99, 143ee5c84, 644ade433): chat:new:<dir> and place:<dir> targets, send-time check, tap fallback, iOS mirror, box-agent docs.

The boxholder tapped a `chat:new` notification ("Journal time — no entry for
today yet"). The new chat opened at the box root with a pending question card
in the companion pane (`card=_bookkeeping/questions/<Name>.question.card` in
the URL) and the hint "Answer the question … here, or start something else."
The notification banner sat at the bottom above the composer.

An unstarted root chat offers a pending question by design. When the chat was
opened from a notification, the person came for that notification, and the
question competes with it. A chat a notification opens should show only what
the notification names: its banner, and its card if it names one.

Related: [notification targets cannot name a place](2026-11-10-notification-target-cannot-name-a-place.md).
