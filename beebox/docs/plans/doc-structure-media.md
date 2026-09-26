---
title: "Documentation structured like code: media"
status: active
workstream: doc-structure
issues: []
---
# Documentation structured like code: media

Eighth cluster under the [organizing principles](../README.md#organizing-principles):
the three pages about media files (git-annex assets, the image orientation
contract, on-demand image transforms) become members of one `media` subject.
The before-run found every fact in 2 to 4 steps; this cluster is for the
parent and one page that had all its facts above any heading.

**Issues addressed:** none filed.

## Smallest fix and budget

Smallest fix: give the transforms page headings. Chosen: parent plus three
members, ~315 lines moved, ~20 rewritten, one manifest allowlist line, about
30 hand-repaired references.

## Stated preferences this plan trades against

The principles as written.

## What already exists

The pilot's tooling; flat publish paths.

## Prior art (external)

None needed.

## Ontology

Members: assets (`src/lib/asset-extensions.ts`, `src/core/annex/`), image
orientation (`src/shared/image-orientation.ts`), image transforms
(`/api/images/*`, `.beebox/image-cache/`).

## Tracks / scope

| Old | New |
|---|---|
| (new) | `media.md`: what media is in a box; members; owned elsewhere (attach scopes in the card format, phone photos in the box docs) |
| `assets.md` | `media/assets.md` |
| `image-orientation.md` | `media/image-orientation.md` |
| `image-transforms.md` | `media/image-transforms.md`, with headings (its facts sat above any heading) |

## Could this be simpler?

Add headings to the transforms page and stop. The directory is the walkable
name.

## Subplans

none.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Fact dropped in the move | section-hash check | zero missing before commit | clear |
| Code comments and tests cite old paths | no | repo-wide sed then grep | clear once grepped |

## Agent-flow / user-flow edge cases

Stale ref: `doc-check`. Hand-edit drift: periodic review.

## NOT in scope

`docs/box/phone-photos.md` (box-facing), the card format's attachment rules.

## Open design questions

none.

## Knowledge audits

Skipped: nothing box-loaded changes.

## What will hold this after it ships

`doc-check`; periodic review.

## Implementation order

Before-run (done); chunk 1 moves; chunk 2 rewrite; after-run; Codex review.

## Rollout shape

Questions (pilot protocol):

| # | Question | Key string |
|---|---|---|
| 1 | Status for absent asset content; why not 404? | `409` |
| 2 | Why `annex.thin=false`; what repair needs beyond the config? | `annex.thin` |
| 3 | What blocks an unlisted large binary; the threshold? | `1 MB` |
| 4 | The orientation invariant; the contract predicate? | `isOrientationNormalized` |
| 5 | Transform query parameters; max dimension after dpr? | `4096` |
| 6 | Where derived images live; expiry and size bounds? | `image-cache` |

### Before (2026-09-26)

| # | Found | Steps | Cited |
|---|---|---|---|
| 1 | yes | 3 | assets.md#Absent content |
| 2 | yes | 4 | assets.md#Configuration |
| 3 | yes | 2 | assets.md#What counts as an asset |
| 4 | yes | 3 | image-orientation.md#The invariant |
| 5 | yes | 3 | image-transforms.md (no heading; the title section) |
| 6 | yes | 3 | image-transforms.md (no heading; the title section) |

### After (2026-09-26)

| # | Found | Steps | Cited |
|---|---|---|---|
| 1 | yes | 3 | media/assets.md#Absent content |
| 2 | yes | 4 | media/assets.md#Configuration |
| 3 | yes | 4 | media/assets.md#What counts as an asset |
| 4 | yes | 3 | media/image-orientation.md#The invariant |
| 5 | yes | 4 | media/image-transforms.md#Parameters |
| 6 | yes | 3 | media/image-transforms.md#The cache |

### Cross-model review of the diff (Codex, 2026-09-26)

One finding, applied: the parent's phone-photos pointer was code text,
not a link. The transform limits (4096, `dpr` at most 2, quality 85, 30
days, 512 MiB, two concurrent) were verified against the route code.
