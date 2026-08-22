---
title: "Rename the Drive comments sidecar to .gcomments.json, following the .doc.json precedent"
workstream: dev-comments
area: callback-box
filed-by: agent
discovered-by: Ian
discovered-in: worktree-dev-comments — naming the dev-repo document comments store
labels: [connectors, naming]
needs: [design]
---

Google Drive comment threads are written beside an exported card as
`<basename>.comments.json` (`callback-box/src/connectors/drive-comments-sidecar.ts:25`),
referenced by a `comments: { ref }` field, rendered by `AttachedComments.tsx`,
and described to box agents in `core/box/skills-content.ts:317,323`.

The dev-repo document-comments work
([document-comments](../../callback-box/docs/plans/document-comments.md)) writes
boxholder-authored comments as `<basename>.comments.yaml`. The two are one
extension apart and are different things: Drive's are upstream-derived,
threaded, read-only, and per-card; the dev-repo's are boxholder-authored, flat,
cleared once handled, and never in git.

The boxholder's read (2026-08-22): the Drive sidecar is not much of a precedent
and should not hold the general name — *"we can rename the google doc comments
to `.gcomments.json` (for a while google docs were `.doc.json` and got renamed
for similar reasons)"*.

This is a change to an on-disk shape that existing boxes already hold, so it
needs a migration rather than a rename in place — see the `cb-migration` skill.
Touch points: the sidecar writer, the `comments: { ref }` values already stored
in card frontmatter, the agent guide text, and the frontend reader.

Not urgent. The dev-repo work proceeds under `.comments.yaml` either way; this is
about which of the two owns the plain name.
