---
title: "Bulk upload lands in an uncommittable box-root directory and fails silently when its chat message never delivers — recurred 3 times on one production box"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
priority: important
---

A recurring three-part failure hit one production box's bulk-photo-upload path
three times in one week (photo counts: 12, 6, and 4; each a live, dated event
whose record would have gone unmade). Each time: the uploader never told the
person it failed, the batch landed somewhere no commit can ever save it, and
by the third occurrence there was no signal at all — an agent only found it
because it blocked an unrelated commit.

## Part 1 — delivery failure is invisible to the uploader

The `<upload>` chat message that is supposed to announce a finished batch
failed to deliver (`state ?? "failed:prepare"` in
`beebox/src/core/bulk-upload/worker.ts:56`) in all three instances. Nothing in
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

The box-root vocabulary (`beebox/src/lib/box-root-vocabulary.ts`, enforced via
`beebox/src/lib/box-namespace.ts` and `box-reserved-segments.ts`) is a closed
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
