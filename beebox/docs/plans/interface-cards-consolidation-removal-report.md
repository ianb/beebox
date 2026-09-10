---
title: "Interface card consolidation — removal report"
status: active
workstream: interface-as-cards
issues: []
---
# Interface card consolidation — removal report

Implementation is in progress under the [consolidation plan](interface-cards-consolidation.md).
Counts are physical lines including comments and blanks, not performance claims.
A negative net removal means growth. Moved behavior counts at its destination.

## Baseline and accounting

- Planning baseline: `2fe4d4d897d3a7bb97da505989eab74c3a280878`.
- Implementation start: `e72487d1dad6c473a4cf124b1c2724cee1e79214`.
  Intervening commits only change planning documents.
- Frontend source baseline: **625 files / 75,482 lines**, tracked `.ts`, `.tsx`,
  and `.css` under `beebox/src/frontend/src/`.
- Counts use `git diff --numstat --find-renames <start> <end>` and
  `git diff --name-status --find-renames <start> <end>`; totals group frontend
  production, other production/tooling, tests, and documentation separately.
- Stage ranges are adjacent and nonoverlapping. Cumulative comparison begins at
  implementation start. Unrelated main changes are excluded by commit attribution.
  No stage is counted as complete before its required checks pass.

## Stage results

Results below describe completed implementation stages; browser and final
acceptance remain separately tracked.

| Stage | Commit range | Frontend added / deleted / net removed | Other production added / deleted / net removed | Tests added / deleted | Docs/other added / deleted |
|---|---|---|---|---|---|
| A: single-card entry | `e72487d1d..2eb9189e5` | 117 / 371 / **254** | 0 / 0 / 0 | 34 / 3 | 64 / 9 |
| B: canonical seeds/cohorts | `2eb9189e5..bdb8798d9` | 0 / 0 / 0 | 208 / 45 / **−163** | 125 / 12 | 13 / 8 |
| A follow-up: explicit chat reveal | `bdb8798d9..4ffacb515` | 92 / 19 / **−73** | 0 / 0 / 0 | 67 / 1 | 0 / 0 |
| C: Questions/Landmarks | Pending | — | — | — | — |
| D: History | Pending | — | — | — | — |
| E: Storage/Admin/utilities | Pending | — | — | — | — |
| F: alternate presentation removal | Pending | — | — | — | — |

## Retired UI and surviving behavior

**A:** deleted CardViewPage, ViewPage, OpenChatControl and the orphaned useUrlView
hook. Removed the FileView page-only mode/header and its card-theme branches.
Retired the separate Back to Dashboard and page Chat/New buttons; explicit chat
actions survive inside CardActions with full target state and native-composer
mode preserved. Four files deleted; shared behavior moved is counted as additions. Keep source/media/capture dialogs, recipient history,
the draft/emission runtime, native bindings, and ambient replies. Legacy URL and
old-history read adapters are reported as retained, not hidden from the count.

**B:** added five schemas and the new migration; no files removed. The historical
migration still seeds and validates only its original three cards. New enrollment
requires all eight, preserving existing notes and protecting staged deletions.
This stage grows production code by 163 lines; it is not UI removal.

## Verification and limits

**A:** affected doctests passed (3 files, 27 assertions), exact changed-file ESLint
and all commit typecheck/doc gates passed. A live legacy card link entered the
workspace; its projected URL retained nativeComposer. Review found that explicit
chat actions lacked an intent to reveal chat from a focused workspace. The
follow-up uses existing pane actions after the recipient binds. Desktop before image and
DOM snapshots are retained for the final exhibit. Full IC-1 through IC-9, knowledge
audits, implementation review and remaining stages are still outstanding. No bundle-size, speed, device, or production claim follows from
a line-count reduction.

**B:** focused migration/cohort checks passed 64 assertions; related schema,
initialization and package checks passed 263. The broader affected run completed
418 files with 5,524/5,525 assertions passing. Its sole failure was a fixture's
tracked-file count (54 → 59 after the new seeds); the corrected fixture passed all
3 assertions on rerun. All commit typecheck/lint/doc gates passed. No deployed
box was migrated by this stage.

**A follow-up:** all 419 affected test files passed, plus 57 focused navigation
assertions and frontend typecheck/lint. Browser verification confirmed a new
recipient, retained Dashboard target/native mode, desktop split layout, and
mobile transcript with Dashboard as its return target. The one-shot intent was
cleared. An empty native transcript has no composer controls; their absence is
not evidence that chat is hidden. Browser animation frames stopped advancing in
this session, so the walkthrough used reduced-motion mode and reloaded after
viewport changes; animation behavior is not verified by it.
