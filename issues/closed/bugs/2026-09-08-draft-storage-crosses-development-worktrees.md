---
title: "Unsent composer drafts cross development worktrees sharing a box slug"
workstream: chat-everywhere
resolution: implemented
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

## Closed 2026-09-12 — keyed per box instance, and the scope helper consolidated

Both draft slots are now keyed by box *instance* rather than box slug:
`emissionKey` (composer) and `draftKey` (dictation — the same key shape, with
its own comment pointing at `emissionKey`, so fixing one and not the other would
have left the identical bug next door).

The instance segment is the existing `storageScopeFor(apiBase)` value that
conversation selection, pending sends and the workspace already key by, so no
new concept: `main/test1`, `worktree-foo/test1`, and the empty string in
production. Empty scope means the key is byte-for-byte what it was, which is the
"retain production keys" this issue asked for — a boxholder's real unsent draft
is not orphaned by a dev-only fix.

On the ambiguous existing dev draft: nothing adopts it and nothing deletes it.
Legacy per-session adoption (`adoptLegacyComposerDrafts`,
`adoptLegacyDictationDrafts`) now runs only when the scope is empty, because a
legacy key carries the slug alone and cannot be attributed to a checkout —
importing it would put one clone's text in another, and deleting it is the one
outcome that cannot be undone. The old `bbx-input-emission:<slug>` value is
likewise left in place, unread. It is dev-only state belonging to the one person
who can see it, so it did not seem worth a recovery notice; say so if you'd
rather have one.

While here: `conversationStorageScope` had grown **two** definitions (in
`chat/conversation/storage-scope.ts` and `chat/workspace/workspace-storage.ts`),
and drafts wanted a third caller outside chat. It is now one function,
`storageScopeFor` in `src/frontend/src/lib/storage-scope.ts` — renamed because
the value is about the box instance rather than conversations, and because the
old name collided with the `storageScope` variable it is assigned to everywhere.

Doctests pin two checkouts keeping their own text, production's key being
unchanged, and dev adoption taking nothing while deleting nothing.
