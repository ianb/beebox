---
title: "iOS quick capture: wait in the ignored incoming folder, like Clerk sends"
workstream: clerk-quick-send
resolution: implemented
area: beebox
labels: [quick-chat, capture, ios]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-clerk-quick-send — choosing where a Clerk send waits
---

**Closed:** Resolved in 87c44d075 and f4e6f2e18 with the boxholder's choice "Routed ones to incoming": a phone capture with typed or dictated words waits uncommitted in the git-ignored `_content/incoming/` until its chat files it; captures with no words stay committed in `_content/captures/`. Voice recordings stay committed in `_content/captures/` even with typed words. That exception was the implementer's choice, put to the boxholder, who has not answered yet; flip `sourceDirectory` in `beebox/src/core/quick-capture/source.ts` if they want recordings in incoming too.

iOS quick capture commits its source memo on arrival at
`_content/captures/<id>.memo.card` (`beebox/src/core/quick-capture/source.ts`,
`materializeCaptureSource`: `stageAndCommitPaths(... "Retain quick capture source")`).
A page sent from the Clerk now waits uncommitted in `_content/incoming/`,
which git ignores through a folder-local `.gitignore`, and the chat agent
commits it when it files it
([plan](../../../beebox/docs/implemented-plans/clerk-quick-send.md)).

The boxholder chose the ignored folder for Clerk sends and said: "probably
the ios quick capture should do the same" (2026-10-15).

Why this is not a one-line change: iOS capture relies on the commit for
durability before transcription and dispatch. `source.ts` says "Source
ownership is committed before transcription; a restart cannot recreate a
deleted source", and `findCaptureSource` scans committed memo cards by
`share-id`. Moving to an uncommitted folder changes what survives a restore
from git, how a deleted source is detected, and the agent prompt for
`source-ref` (`beebox/src/core/chat/session/prompts.ts:55`).
