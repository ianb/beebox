---
title: "Fresh Claude session reservation suppresses first-run opening suggestions"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walk — journey F review
---

Opening a fresh box through its ordinary root URL showed only “Start a
conversation.” The fixture briefing already contained two valid openers,
including “What can you do?”. Screenshot 01 of the
[journey F report](../../beebox/user-stories/journeys/F-newcomer/reports/2026-09-21.md)
shows neither suggestion before the first message.

## Verified mechanism

Paths below are under `beebox/src/frontend/src/`:

- `router.tsx:95–105` redirects the box root to `/chat`, with no session ID.
- `components/chat/everywhere/resolve-conversation.ts:47–70` reserves a UUID
  for a fresh Claude conversation and returns a `session` target.
- `components/chat/everywhere/BoxConversationShell.tsx:83–94` passes the UUID
  as `sessionInput` instead of `"new"`.
- `components/chat/InteractiveChat.tsx:75–77` queries and returns openers only
  when `sessionInput === "new"`.
- `components/chat/InteractiveChat-messages.tsx:265–270` therefore renders
  its fallback instead of `ChatOpeners`.

The first capture has the reserved session in its URL. The walker opened the
ordinary root; no harness script supplied an old session. This is a mismatch
between fresh-session reservation and opener gating, not missing briefing
content. Preserve the difference between a fresh empty reservation and an
existing conversation when repairing it. No product fix was attempted.

Related: [the broader first-screen design issue](../features/2026-08-23-first-screen-says-nothing-about-what-this-is.md)
and [first-run experience](../features/2026-07-20-first-run-experience.md).
