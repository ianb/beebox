---
title: "A reply's callout always renders after all its prose, so a sign-off written after it shows above the answer"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — F-newcomer journey walks, 2026-10-09
---

In the F-newcomer walk, the agent wrote a `<callout>` first and a sign-off after it ("You're welcome to just say 'nah, leave it.' Have a good evening.", transcript 12:40:56). The chat showed the sign-off above the answer, because every prose group renders first and the callout stack renders last. Shot 31.

`beebox/src/frontend/src/components/chat/ChatMessages/view.tsx` pulls callouts out of the message text (`:117-121`) and renders them in `CalloutStack` after all groups (`:192`). Order inside the message is lost.

Second symptom: the callout's `context` attribute renders as an uppercase eyebrow (`beebox/src/frontend/src/components/chat/CalloutBlock.tsx:40-41`). The prompt asks for a `context` that reads cold in a notification (`beebox/src/core/chat/session/prompts.ts:157`). In the chat it restates the question the person just read. The walker called it "shouty small-caps".

Two fixes are possible and the choice is open: render callouts in text order, or tell the agent to end its reply with the callout. The second does not help messages that already exist.

Report: [F](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-09.md) (rows 72, 73).
