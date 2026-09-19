---
title: "Image and audio cards with a box-absolute filename.ref show \"Failed to load\""
workstream: card-self-refs
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
resolution: implemented
---

> **Closed** — `d372196e9` fixed the immediate stem bug (dotted card titles).
> `c89c07681` added the `filename-attach-scope` migration that repairs
> confidently-owned flat-layout cards and reports the rest; `76348dc5e` and
> `04bc2ef96` (the `v2-refs-to-v3` migration, added at boxholder request)
> covered review findings and residual v2-form refs. Per the boxholder's
> 2026-09-18 direction, the migration is best-effort and exits 0 on ambiguous
> cards; `beebox/src/core/card-lint.ts` now warns on any remaining
> non-`attach/` `filename.ref` so an agent can finish the tail. Not run on any
> real/production box yet — it ships with the ordinary deploy migration sweep.

`resolveImageCard` in `beebox/src/webapp/box-image.ts:43` accepts a
`filename.ref` only when it starts with `attach/`. Any other ref resolves to
null, and the card shows "Failed to load".

Archived capture directories use a flat layout: `photo-004.jpg` next to
`photo-004-<title>.image.card`, with `filename.ref` as a box-absolute path.
The capture archiver or the one-root migration wrote that form.

On one production box, 1,025 image cards and 103 audio cards were affected. A box
agent moved every file into its card's `.attach` scope and rewrote the refs
by hand on 2026-09-15. Other boxes with archived captures may still have this
layout.

## Direction (2026-09-16)

The developer wants an automatic repair: remove the box-absolute path and write
the ref that the card should hold, when that target can be determined with
confidence. Example: the absolute ref names a file in the card's own directory
that shares the card's stem, so the file moves into `<stem>.attach/` and the
ref becomes `attach/<file>`. When the target is ambiguous, report the card and
leave it unchanged.

This also removes the case that
[bbx mv self-refs](2026-09-16-bbx-mv-directory-leaves-self-refs-stale.md) trips
on. Check what writes the flat layout today, so new archives do not create
more. Decide whether the repair runs as a migration, in `bbx validate --fix`,
or both.
