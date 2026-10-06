---
title: "Bulk upload lands in an uncommittable box-root directory and fails silently when its chat message never delivers — recurred 3 times on one production box"
workstream: bulk-upload-stranding
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
priority: important
resolution: implemented
---

Closed: fixed in ff50dcb0e (landing dir under `_content/`, failure notification, reconciled failed count); see Resolution below.

A recurring three-part failure hit one production box's bulk-photo-upload path
three times in one week (photo counts: 12, 6, and 4; each a live, dated event
whose record would have gone unmade). Each time: the uploader never told the
person it failed, the batch landed somewhere no commit can ever save it, and
by the third occurrence there was no signal at all — an agent only found it
because it blocked an unrelated commit.

## Part 1 — delivery failure is invisible to the uploader

The `<upload>` chat message that is supposed to announce a finished batch
failed to deliver (`state ?? "failed:prepare"` in
`beebox/src/core/bulk-upload/worker/core.ts:56`) in all three instances. Nothing in
the reports suggests the person who uploaded ever saw an error — they had
every reason to believe the upload worked. The only way any of the three
failures surfaced was an agent noticing a self-note, or — the third time —
noticing only because the stray directory blocked a later, unrelated commit.

## Part 2 — the landing directory is one the box can never commit

`beebox/src/core/bulk-upload/prepare.ts:313` computes the batch directory as:

```
const uploadRelDir = opts.contextDir !== "" ? `${opts.contextDir}/tmp-upload` : "tmp-upload";
```

When `contextDir` is empty, the batch lands at `tmp-upload/` directly under
the box root. `docs/box-docs/card-upload-batch.md` documents the intended
location as "inside the chat's context dir," but this box's chats are flat
cards under `_content/chat/web/` with no per-chat context dir, so every batch
falls through to the box-root case.

The box-root vocabulary (`beebox/src/shared/box-root-vocabulary.ts`, enforced via
`beebox/src/shared/ref-path/box-namespace.ts` and `box-reserved-segments.ts`) is a closed
list of names allowed directly under the box root, and `tmp-upload` is not one
of them. So the pre-commit hook refuses every commit that touches the
batch, with the message "Box root: tmp-upload: the box root is a closed
vocabulary — user content goes under `/_content/`." An agent that finds the
stranded batch has to `bbx mv` it into `_content/` by hand before anything
can be saved — every recovery requires knowing to do this first.

## Part 3 — the failure-count in the batch card can be wrong

One instance also showed the delivered card's `failed` count including a file
(`photo-009`, "The request timed out") that was actually present at full size
and matched the manifest hash — i.e., a transient failure that self-healed on
retry left the card falsely reporting data loss.

## Why the fix is not obvious

- Part 1 needs a user-visible failure path in whatever surface the person
  uploaded from (web composer, iOS app) — that is front-end/native work, not
  just a backend retry.
- Part 2's fix could go two ways: make `prepare.ts` fall back to a
  vocabulary-legal location when there is no context dir (e.g. under
  `_content/inbox/` or `_tmp/`, matching the manual rescue agents already do),
  or extend `card-upload-batch.md`'s stated contract and give box authors
  without per-chat context dirs an explicit alternative. Either choice changes
  a documented path shape that other code may assume.
- Part 3 (the stale `failed` count) needs the delivery/retry bookkeeping in
  `worker.ts`/`prepare.ts` to clear an entry once a retry actually lands the
  file — tracing exactly where the retry succeeds without updating the
  original failure record was not done as part of this triage pass.

## Evidence (structural only — no card content)

Three occurrences: 2026-09-12 (12 files), 2026-09-13 (6 files), 2026-09-19 (4
files), all on channel `web-desktop` or `ios-native`, all recovered by
`bbx mv`-ing the batch into `_content/` and committing by hand.

## Re-encounter (2026-10-01)

On a production box, a box agent found four more stranded iOS upload batches
dated 2026-09-12 to 2026-09-20, recovered them to `_tmp/stranded-uploads/`
unfiled, and sent the boxholder a `dot` notification on 2026-09-30. The
landing path in `prepare.ts:313` is unchanged on main. Commit `326ed9c74`
(2026-09-28, detaching bulk workers from the request's permit) may address the
Part 1 delivery failure, but no upload after it has been checked.

## Resolution (2026-10-06, worktree-bulk-upload-stranding)

- **Landing dir.** A root-scope chat (`contextDir` `""`) now lands under
  `_content/tmp-upload/` through `landmarkScanRelDir`. This is the existing v3
  rule that maps the root scope to `_content/`. Capture had the same latent
  fallback (`tmp-capture/` at the root) and was fixed the same way. The
  documented contract ("inside the chat's context dir") is unchanged; only the
  root-scope case moved.
- **Silent failure.** The refused root commit was itself what produced
  `failed:prepare`, so the landing-dir fix removes the observed cause.
  `326ed9c74` fixed a separate cause (permit expiry). Any `failed:*` now sends
  the boxholder a `quiet` notification to the target chat. The iOS app reports
  `failed:*` seen within its 30-second poll as a failure, not as "still
  processing". The web bulk uploader was removed on 2026-09-06, so iOS is the
  only uploader.
- **Stale `failed` count.** The server drops reported failures whose bytes
  arrived in staging (`failedItemsNotArrived`).

**Recovering a box that still has stranded batches.** No migration is needed,
because the root-path batches never committed. `bbx status` / `bbx validate`
list any stray root `tmp-upload/`. Move it with
`bbx mv tmp-upload/<slug> _content/tmp-upload/<slug>` and commit. Alternatively,
delete the uncommitted root copy and set the staging session from `failed:prepare`
back to `sealed`, and the sweep re-prepares it at the new path. Batches already
rescued by hand (for example into `_tmp/stranded-uploads/`) need no action.
