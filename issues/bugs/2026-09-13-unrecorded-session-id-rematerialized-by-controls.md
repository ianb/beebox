---
title: "A session id with no record can be re-materialized into a resumable, guessed-engine session by `setModel`/`setFeature`, bypassing the recorded-engine check"
workstream: unattached
area: beebox
labels: [chat, box-shape]
filed-by: agent
discovered-by: agent
discovered-in: worktree-box-state-not-tracked — cross-model review of the unknown-session-id fix
---

The chat reads now refuse to route an unrecorded session id to a guessed engine
(`resolveRecordedChatEngine`, `issues/bugs/2026-09-03-rename-left-old-gitignore-boxes-commit-state-dir.md`).
Two other doors reach the same hazard and were left alone as out of scope. Both
predate that fix; neither was introduced by it.

## The controls door

`setModel` (`src/webapp/trpc/routers/chat-control-procedures.ts:208`) and
`setFeature` (`:276`) resolve the engine with `resolveChatEngine` — the box
default for an unrecorded id — and then call `registry.getOrCreate(input.session)`.
`getOrCreate` (`src/core/chat/session/registry.ts:229`) puts the id in
`this.entries`. After that, `deletion.hasAssignedSession`
(`src/core/chat/session/registry-deletion.ts:22`) finds it, and
`resolveSessionAvailability` (`src/core/chat/session/availability.ts:78`)
returns `{kind: "resumable"}` BEFORE it reaches the recorded-engine check below.

So the sequence is: a stale tab toggles a model or a feature on an id the box has
no record of, the toggle registers the id, availability then calls it resumable,
and the send path admits it (`src/webapp/routes/chat-send-target.ts:77` →
`src/core/chat/session/target.ts:65` → `src/core/chat/session/index.ts:190`) and
resumes the box-default engine for a session that engine never had. Feature
persistence can also write a history row stamped with the guessed engine
(`src/core/chat/session/history.ts:375`), which makes the guess durable.

Two candidate remedies, and choosing between them is the decision: gate the
mutating controls behind the same recorded-session check the reads now use, or
stop treating a `getOrCreate` entry as proof of assignment until a real start has
happened. The second is the stronger invariant and the larger change.

## The thread-session door

`ChatThreadSession` resolves its stored `sessionId` with `resolveChatEngine`
(`src/core/chat/session/thread.ts:140`) and starts the backend with
`resumeSessionId` (`:167`), with no availability check at all. An id whose
records are gone gets the guessed engine preflighted and spawned.

What it should do instead is the open question: fail unavailable, start a fresh
session, or probe for the transcript first. A thread session is not a browser tab
and cannot be told to reload, which is why the answer is not obviously the same
as the web chat's.

## Why this is filed rather than fixed

The authorized fix was the history read on a live chat, which is what the
`git reset --hard` incident produced. These are adjacent reachable failures
through different entry points, and both remedies are invariant changes rather
than local corrections.
