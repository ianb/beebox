---
title: "The landmark HQ dictation toggle waits on a synchronous git commit, hook included, before the UI responds"
workstream: unattached
area: beebox
labels: [voice, ui, git, performance]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "the landmark hq transcription toggle is very slow to respond (is it doing a whole git thing there?)"
priority: normal
resolution: wontfix
---

Yes, it is doing a whole git thing. The landmark-scope HQ toggle in the voice
chip calls `landmarks.setHqPreference` and only updates after the mutation
resolves (`src/frontend/src/components/chat/VoiceChip.tsx:238`, invalidates
on success). The mutation (`src/core/landmark/hq-preference.ts`) rewrites the
landmark card under the card lock, then calls `stageAndCommitPaths`
(`src/lib/git.ts:371`) and awaits it. That call:

- takes the box git lock (`withBoxGitLock`), so it queues behind any
  autocommit, sweep, or agent commit already holding it;
- runs `git add` plus `git commit`, and the commit runs the box's managed
  pre-commit hook: `git annex pre-commit .` on an annexed box, then a `bbx`
  cold start for card validation. On a warm dev machine the hook alone is
  about a second with nothing staged; a hosted box pays annex plus a slower
  disk on top, and any lock wait comes first.

The box-scope toggle (`admin.updateBoxConfig` via
`src/webapp/box-config-write.ts`) has the same shape: the git commit runs
inside the write's critical section and the response waits for it. The
per-chat toggle does not commit and is the one that feels instant.

The mechanism is correct for durability and wrong for a toggle. A preference
flip is a one-line frontmatter change whose value the server already has the
moment the file is written; the commit is bookkeeping.

Directions, none decided:

- **Respond after the write, commit after the response.** Return once the
  card is written and let the commit run detached (or leave it to the
  autocommit sweep, which exists for exactly this). `hq-preference.ts` already
  returns a `commitWarning` rather than failing the request when the commit
  breaks, so the caller has already accepted that the commit is best-effort.
- **Optimistic UI.** Flip the control immediately, reconcile on the
  `hqPreferences` refetch, revert on error. Worth doing regardless of the
  server change; the two together make the toggle feel like a toggle.
- **The lock.** If the lock wait is the dominant cost on the hosted box, the
  fix above removes it from the request path but not from the commit; that
  is fine as long as nothing user-visible waits on it.
- The same pattern is used by twelve other writers (`grep stageAndCommitPaths
  src/core src/webapp`). Most are agent-side or batch paths where waiting is
  right. Sort them: which are user-facing interactions and which are jobs.

Related: `issues/decisions/2026-08-30-rethink-box-autocommit.md` (what
should commit, and when); `issues/features/2026-08-26-sticky-hq-transcription-
preference.md` (the scope controls this toggle belongs to, still on its iOS
manual-testing gate).

## Reconfirmed live 2026-09-13 — unchanged, with the cost measured

The `reconfirm?` guess does not hold. Both halves of the mechanism are exactly as
filed:

- `src/core/landmark/hq-preference.ts` still `await`s `stageAndCommitPaths` inside
  the request, returning `commitWarning` after it.
- `VoiceChip.tsx` still updates only in the mutation's `onSuccess` (invalidate on
  success), so there is no optimistic flip — the control waits for the round trip
  *and* the commit.

Nothing touched either file since the filing; the commits near them are voice
service-picker and HQ-fallback work.

**Measured, since "very slow" deserves a number.** An empty commit through the
managed pre-commit hook on the primary test box, warm machine, nothing staged:

```
real  0m1.302s
```

So the floor for a toggle flip is ~1.3s of hook before any lock wait or annex
work, on the fastest box there is. The issue's estimate ("about a second with
nothing staged") was right, and a hosted box pays more. The probe commit was
reset away; the box is unchanged.

Field removed, issue kept open. Its "Directions, none decided" list is the reason:
respond-after-write changes when durability happens, which is a product call, and
sorting the twelve other `stageAndCommitPaths` callers into interactions versus
jobs is the bigger half. The optimistic-UI direction is the one piece that is
worth doing regardless of how the server question lands.

## Closed 2026-09-13 — the felt lag is gone; the 1.3s to take effect is accepted

Boxholder: "I don't notice a UI delay anymore. That it doesn't really 'take
effect' for 1.3 seconds is fine, it just shouldn't feel laggy."

That settles it on the axis that matters. The complaint was never about durability
timing — it was that a toggle felt like it was doing work. The mechanism measured
above is unchanged (the mutation still awaits the commit, and there is still no
optimistic flip), so what improved is the felt latency rather than the code path.
Closing as accepted rather than fixed, because nothing here was changed.

If it ever feels laggy again, the fix direction is already worked out and does not
need re-deriving: flip the control immediately and reconcile on the
`hqPreferences` refetch (optimistic UI), which is worth doing on its own; and if
the request path is still the cost, return once the card is written and let the
commit run detached — `hq-preference.ts` already treats the commit as best-effort
by returning `commitWarning` instead of failing.

The broader question this issue raised — sorting the twelve other
`stageAndCommitPaths` callers into user-facing interactions versus jobs — is not
closed with it. That belongs to
[rethink-box-autocommit](../../decisions/2026-08-30-rethink-box-autocommit.md), which
already owns "what should commit, and when".
