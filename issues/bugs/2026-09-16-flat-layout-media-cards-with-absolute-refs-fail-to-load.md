---
title: "Image and audio cards with a box-absolute filename.ref show \"Failed to load\""
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
---

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

## Options

- The resolver accepts a box-absolute ref that exists.
- A migration moves flat-layout media into `<stem>.attach/`. This matches the
  current convention and removes the case that
  [bbx mv self-refs](2026-09-16-bbx-mv-directory-leaves-self-refs-stale.md) trips on.

Check what writes the flat layout today, so new archives do not create more.
