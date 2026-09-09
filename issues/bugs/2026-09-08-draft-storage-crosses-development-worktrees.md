---
title: "Unsent composer drafts cross development worktrees sharing a box slug"
workstream: chat-everywhere
filed-by: agent
---

Two development worktrees served on the same origin can both have a `test1`
box. The composer persists drafts in localStorage under
`bbx-input-emission:<boxSlug>`, so those independent box instances share an
unsent draft. This can include temporary attachment paths owned by the other
clone; restoration checks those paths against the current box and can report
those attachments as expired.

Found by code inspection during the cross-model review of the conversation
selection storage fix, not by a separate draft browser reproduction. Relevant
owners are `beebox/src/frontend/src/input/emission-persist.ts` and
`beebox/src/frontend/src/hooks/useEmissionPersistence.ts`.

Conversation selection, startup recovery, pending sends, and ambient metadata
now distinguish development worktrees. The older draft persistence is separate.
A draft fix should retain production keys and decide how to expose an existing
ambiguous development draft without importing it into the wrong clone or
silently discarding its content. Do not infer ownership from the shared slug.
