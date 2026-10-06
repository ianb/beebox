---
title: "Use case worth first-class support: download a remote file into a card's attach scope with a provenance frontmatter entry"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
---

A production box's agent wrote a "save-image" trick because it had no
sanctioned way to do a common research operation: fetch a remote file (an
image from a source page) into a card's `.attach/` scope while also recording
where it came from. The trick was used roughly 200 times in one weekend to
build up a set of cards from public web sources.

## What the trick had to do by hand

- Download the remote bytes into the right card's attach scope, choosing a
  filename and extension.
- Append a frontmatter entry recording `source-url`, `retrieved` (date),
  `credit`, `license`, and a `main` flag for the primary image, so every saved
  asset has an audit trail back to where it came from.

The box reports this provenance discipline paid for itself: when some saved
entries were later found broken, the agent could repair them mechanically by
re-downloading from the recorded `source-url`, because the fetch metadata had
been kept from the start.

## Why this belongs in the platform, not a per-box trick

Nothing under `beebox/src/core/commands` or `webapp/routes` currently offers
"fetch a URL into an attach scope with recorded provenance" as a primitive —
only the human-driven clerk-extension save path exists for images (see the
related, already-filed
`issues/features/2026-09-11-server-side-webpage-capture.md`, which covers the
sibling case of capturing a whole page). Any box that gathers images or files
from external sources — which "any research- or catalog-flavored box" covers
broadly — will reinvent this exact trick: fetch, place, and stamp provenance.

## Why the design is not obvious

- The provenance shape itself (`source-url`, `retrieved`, `credit`, `license`,
  `main`) was invented by one box for one purpose (compiling public profile
  pages); a built-in command needs to decide whether that is the right
  general shape or box schemas should be free to vary it.
- It needs to compose with the schema of whatever card type is receiving the
  attachment — different card types will want the provenance fields named or
  shaped differently, so a single hard-coded frontmatter shape may not fit
  every schema.
- License/credit fields imply a policy question (when is redistribution of a
  fetched image appropriate at all) that a generic command can record but
  should not decide.
