---
title: "Byte sizes format three ways: \"2 KB\" in chat, \"2.0 KB\" in the file view, \"1536.0 MB\" in publications"
workstream: dup-sweep-frontend
area: beebox
labels: [code-quality]
filed-by: agent
discovered-by: agent
discovered-in: worktree-dup-sweep-frontend — frontend pass of the functional-duplication sweep
resolution: implemented
---


**Closed:** implemented by the dup-sweep-frontend branch (plan frontend-unify-formatters-refresh-storage; commits 65147fadb through 1bb95099e). Each commit message names the behavior changes. Wording was covered by unit/DOM tests, not checked in a browser.

Part of the [functional-duplication sweep](../../code-quality/2026-10-22-functional-duplication-sweep.md).
Spans both passes.

- `shared/human-bytes.ts` humanBytes: drops a trailing ".0" ("2 KB"), no guard
  for 0 or NaN. Backend and `shared/delivered-user-message.ts` use it, so chat
  upload chips show its text.
- `beebox/src/frontend/src/lib/format-bytes.ts` formatBytes: `toFixed(1)` below 10 ("2.0 KB"),
  "0 B" for zero, NaN or negative. About ten frontend importers.
- Local copies: `publications/PublicationReviewCard.tsx:280` and
  `browser-task/SubmissionForm.tsx:196` (identical: always one decimal, stops at
  MB), `admin/BackupSection.tsx:22` ("0" with no unit).
- Inline: `InteractiveChat-layout/ChatAttachments.tsx:93` rounds to whole KB though
  the same file imports formatBytes.

Choosing one changes visible text somewhere. The canonical one probably
belongs in `shared/` (the backend pass owns that edit), with the frontend
copies moved onto it after.
