---
title: "bbx mv on a directory does not rewrite absolute refs that cards inside it hold to their own files"
workstream: card-self-refs
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
---

`bbx mv <dir>` rewrites inbound refs from outside the moved directory. It does
not rewrite an absolute ref held by a card inside the directory that points
into the same directory. The common case is an image or audio card whose
`filename.ref` is the box-absolute path of its own media file.

After a move of a legacy capture directory (flat layout, before the
`.attach` scope convention), 27 image and audio cards had stale refs. The
agent fixed them with `sed`. An earlier archived capture on the same box had
the same damage.

Code: `beebox/src/core/commands/move-operations.ts`,
`beebox/src/core/commands/move.ts`.

Related: [flat-layout media refs fail to load](2026-09-16-flat-layout-media-cards-with-absolute-refs-fail-to-load.md).
