---
title: "Autocommit causes a lot of issues — decide how box content commits should actually work"
workstream: unattached
needs: [design]
area: beebox
labels: [cards, git]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "autocommit causes a lot of issues; we should think about how to handle it"
priority: important
---

The box commits its own content automatically (after agent turns, procedures,
capture delivery, generated-docs refreshes, migrations — every writer path
ends in a commit). The boxholder's verdict: **autocommit causes a lot of
issues**, and the handling deserves a deliberate decision rather than more
per-symptom patches.

The symptom trail this month, as the evidence base (each was treated
separately at the time):

- **Dirty-tree wedges**: a prod box skipped its generated-docs refresh on
  deploy ("Working tree is not clean") — an uncommitted half-state blocked an
  automated writer.
- **Lock contention**: `git-lock.doctest` flakes; concurrent writers (chat
  turn + sweep + refresh-maps) racing one index.
- **History noise / weight**: one box's repo at 21G with media committed
  twice (working copy + objects); commit-per-turn makes history unreadable and
  unbrowsable as a record of *meaningful* change.
- **Mid-state commits**: a commit can land between an agent's coordinated
  edits, capturing a half-written card (the same class as the deploy's
  wait-for-quiet dance).
- **Push interacts**: [git-push-confirmation](2026-07-20-git-push-confirmation.md)
  is downstream — what gets pushed is whatever autocommit produced.

Directions worth weighing (the decision, not a menu to implement):

- **Turn/operation-scoped commits**: one commit per agent turn / procedure
  run / capture, with a queue serializing writers — commits become meaningful
  units with real messages, and locks stop racing.
- **Checkpoint cadence**: commit on quiet (debounced), like an editor's
  autosave→snapshot split; between checkpoints the tree is honestly dirty.
- **Keep commit-per-write but fix the writers**: single writer process/queue
  (the event-bus/registry pattern), which fixes contention and half-states
  but not noise or weight.
- Orthogonal but same review: what belongs in git at all (media → annex),
  and whether generated artifacts (MAP.md, agent docs)
  commit separately from content.

Whatever wins must keep the properties autocommit exists for: nothing is
ever lost, every agent change is attributable (the History surface reads
trailers), and cross-machine sync stays possible. A design session should
start by enumerating every writer that commits today.


## Groundwork done 2026-09-12 (no decision taken)

The issue asks that a design session "start by enumerating every writer that
commits today." That enumeration is done, plus measurements from a live box, so
the expensive part is not in the way whenever the direction gets decided. The
boxholder has no intuition on the direction yet and none is assumed here.

### What the history actually looks like

One box, last 7 days: **469 commits** (~67/day), `.git` at **1.3 GB**.

- **252 of them (54%)** are a single trick: `Auto-commit changes from trick:
  generate-image`.
- **99 (21%)** touch only `_bookkeeping/` — no content change at all. Most are
  the procedure triple: `Start procedure:` / `[procedure] <step>:` /
  `Complete procedure:`, where only the middle one carries content.

So roughly three quarters of commits are bookkeeping or one trick's catch-all,
and the meaningful units are buried among them. The mid-state problem shows up
in ordinary traffic too, not just as an edge case: one sampled
`generate-image` commit swept in an unrelated `ilex-appearance.md` edit and a
chat card alongside the image it was actually producing, because the trick
commits with `stageAll`.

### Where commits come from

Every commit in `beebox/src` goes through `lib/git.ts` — no raw `git commit`
anywhere in the engine. Two idioms, and the split matters:

- **`stageAndCommitPaths` (path-scoped)** already dominates *content* writers:
  connectors, capture, bulk upload, card create/move/trash, webapp routers,
  publish, notifications. These commit only what they wrote.
- **`stageAll` (whole tree)** is used by ~10 triggers, all of them sweeps:
  the agent-turn fallback, every procedure step and completion, tick
  housekeeping, docs-refresh residue, migrations, `bbx init`, `bbx upgrade`,
  and tricks. These are where one writer's commit can absorb another's work.

**So the "too many commits" pressure is not evenly spread.** It concentrates in
generated-artifact and housekeeping writers that fire once per *step* rather
than once per *outcome* — which is also where the cheapest wins are.

### The locking story, and the hole in it

There is exactly one serialization point: `withBoxGitLock`
(`lib/git-lock.ts`), keyed on the resolved `.git` dir, reentrant via
`AsyncLocalStorage`, wrapping every mutator in `git.ts`. Readers are
deliberately unlocked. On timeout it logs and proceeds unlocked — a
cooperation optimization, not a correctness barrier.

**It cannot see the box agent's own `git` calls.** A chat agent shelling out to
`git commit` inside its session is entirely outside the queue. That is the root
cause of commits landing mid-way through an agent's coordinated edits, and it
is why tick housekeeping, procedure completion and docs-refresh all re-check
`loadActiveChats` immediately before sweeping — an ad hoc second gate routing
around the hole rather than closing it.

Worth stating plainly for whoever takes this: the agent's own per-turn commit,
**probably the single largest source of commit volume, is not engine code at
all** — it is agent behavior driven by prompt and skill content, so it will not
be found by reading `beebox/src`.

### Constraints any direction must respect

- **Dirty-tree skips are load-bearing, not incidental.** `migration-sweep.ts`,
  `docs-refresh.ts` and `bbx migrate` all deliberately SKIP a dirty box and
  defer to the next deploy. Reducing commit frequency means those sweeps sit
  behind a dirty tree more often; convergence needs a plan that is not "the
  next deploy retries."
- **History facets are keyed on trailers, not on granularity.**
  `webapp/trpc/routers/history.ts` builds `git log --grep` patterns over
  specific trailer vocabularies (`Pulled-By`, `Created-By`, `Fetched-By`,
  `Pushed-By`, `Sent-By`; `Source`/`Endpoint`/`Type`; the feedback keys), plus
  ad hoc `Triggered-By`, `Procedure`/`Step`, `Session`, `Run-By`. Batching or
  squashing is only safe if **one trailer set per logical attribution unit**
  survives — nothing today reads several independent writers' attributions out
  of one commit body.
- **The generated/authored split largely exists already** at the path and
  message level (docs-gen scopes to `isTemplateManagedPath`; connectors and
  commands scope to their own writes). The open question is cadence, not
  separation.
