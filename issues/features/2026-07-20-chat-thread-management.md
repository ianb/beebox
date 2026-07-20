---
title: "Chat thread management: delete, rename, archive"
area: callback-box
filed-by: agent
discovered-in: worktree-open-source-readiness — first-run UX audit for the soft launch
---

No thread-lifecycle operation exists at all — audited 2026-07-20: the chat
tRPC routers (`src/webapp/trpc/routers/chat.ts`,
`chat-session-procedures.ts`, `chat-control-procedures.ts`) expose
navigation, model/feature toggles, `interrupt`, and `restart`, but no
delete, rename, or archive procedure; the session pickers
(`SessionListButton.tsx`, `ChatsLandmarkCard.tsx`) render only links, no
management affordances.

**Delete is boxholder-requested for the launch era (2026-07-20).** It's a
trust/data-lifecycle feature: someone trying the system will produce junk
threads and test messages and needs to clear them — and "I can't delete a
conversation" reads badly in a system whose pitch is user ownership.

Design notes: sessions live on disk, so delete should follow the existing
file-deletion pattern (`DELETE /api/files/*` pre-commits dirty state, then
commits the removal — git-recoverable, `api-files.ts:219-292`). Decide
whether delete is hard-remove-with-git-history or a trash/archive move
(`store/trash/` already exists in the box layout). Rename/archive are
natural companions but delete is the ask.
