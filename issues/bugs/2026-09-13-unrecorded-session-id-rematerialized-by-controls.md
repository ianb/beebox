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

## Why this was filed rather than fixed at the time

The authorized fix was the history read on a live chat, which is what the
`git reset --hard` incident produced. These were adjacent reachable failures
through different entry points, and both remedies were invariant changes rather
than local corrections.

> **Both doors closed 2026-09-13** in `3c220e44f` and its follow-up, along with a
> durable variant found while tracing them: `updateFeaturesForSession` filled a
> new row's `engine` with the box default, so a chat reserved as `claude` on a
> codex-default box was recorded as `codex` permanently on its first feature
> toggle. `engine` is now a required argument, `FeatureStore` declines to write a
> row for a session nothing recorded rather than inventing one, the availability
> gate requires a live run (`hasLiveRun`, split from `hasAssignedSession` because
> `archiveChatSession` needs the loose meaning), the controls answer `NOT_FOUND`,
> and `ChatThreadSession` starts fresh instead of resuming a phantom.

## Still open: a third door, in background bulk-upload

Cross-model review found one more materializer, left unfixed because its remedy
needs a product decision. `injectUnfiledSelfNote` and `injectStrandedSelfNote`
take persisted session ids from stale upload cards and staging records
(`src/core/bulk-upload/sweep.ts:122`, `:302`) and call
`runtime.registry.getOrCreate(targetId)` directly
(`src/webapp/routes/bulk-upload-lifecycle.ts:43`, `:90`), with no availability
check. If a box's chat records were rewound, this recreates the ghost entry, and
the next send resolves the unrecorded session through `resolveStartEngine`'s
default fallback (`src/core/chat/session/start.ts:123`).

The gate tightening means such an entry no longer makes availability lie about
it, so the reachable harm is narrower than it was. What is undecided is what
these background notices SHOULD do when their recorded target is gone: skip the
notice, redirect it to the most-active chat, or start a fresh one. Each loses
something different, and the notice exists to tell the boxholder something.
