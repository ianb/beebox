---
title: "Documentation structured like code: how development happens"
status: active
workstream: doc-structure
issues: []
---
# Documentation structured like code: how development happens

Seventh cluster under the [organizing principles](../README.md#organizing-principles):
the narrative series about how the engine is developed (process overview,
agent coding, workflow, technologies, maintenance) becomes a `development`
subject whose parent is the existing overview page.

**Issues addressed:** none filed.

## Smallest fix and budget

Smallest fix: correct the stale schedule count on the maintenance page.
Chosen: parent plus four members, ~310 lines moved, ~40 rewritten, one
manifest allowlist line, about 60 hand-repaired references (maintenance has
29 inbound, mostly from code-style and skills).

## Stated preferences this plan trades against

The principles as written. The four member pages are a public narrative
(`dev/` on the site) and describe rather than specify; where one restates a
rule whose home is `code-style.md` or the engineering principles, it now says
less and links.

## What already exists

The pilot's tooling; flat publish paths; the site's `start-here` list names
publish basenames, which do not change.

## Prior art (external)

None needed.

## Ontology

Members: agent coding (who writes the code and the checks around it),
workflow (workstreams, issues, recurring work, comments, planning, exhibits),
technologies (the stack and the AI services), maintenance (periodic tasks and
touch-triggered tools). `engineering-principles.md` and `module-map.md` are
the code's own subject and stay flat.

## Tracks / scope

Found by reading and by the before-run (2026-09-26):

| Fact | Where | Problem |
|---|---|---|
| Enrolled schedules | maintenance.md "four enrolled today"; development-workflow.md lists eleven | contradiction; the navigator returned four |
| Commit trailers | inline under development-workflow.md "Workstreams" | eight steps to find; needs a heading |
| Lint suppression rule | agent-coding.md, engineering-principles.md #11, code-style.md | three homes; the narrative page says less and links |

Target tree:

| Old | New |
|---|---|
| `development-process.md` | `development.md`, the parent, with a members table |
| `agent-coding.md` | `development/agent-coding.md` |
| `development-workflow.md` | `development/workflow.md` |
| `technologies.md` | `development/technologies.md` |
| `maintenance.md` | `development/maintenance.md` |

## Could this be simpler?

Fix the count and stop. The directory is the walkable name.

## Subplans

none.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Fact dropped in the move | section-hash check | zero missing before commit | clear |
| code-style, skills, tests cite old paths | no | repo-wide sed then grep, including tests and the doc-graph table | clear once grepped |

## Agent-flow / user-flow edge cases

Stale ref: `doc-check`. Hand-edit drift: periodic review.

## NOT in scope

`engineering-principles.md`, `module-map.md`, `code-style.md`, `CONTRIBUTING.md`.

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
| 1 | Which skill creates a workstream; why a briefing? | `launch-worktree-session` |
| 2 | Which schedules run hourly; how many are enrolled? | `hourly` |
| 3 | Which trailers do hooks stamp; what must `Issue:` name? | `Issue:` |
| 4 | Which transcription backends; which only via OpenRouter? | `Voxtral` |
| 5 | The one sanctioned lint suppression; what is never allowed? | `eslint-disable-next-line` |
| 6 | Where is `pnpm lint:knip` run from, when, and what happens to a flagged entry point? | `knip.ts` |

### Before (2026-09-26)

| # | Found | Steps | Cited | Locations |
|---|---|---|---|---|
| 1 | yes | 3 | development-workflow.md#Workstreams | 1 |
| 2 | wrong | 8 | maintenance.md#What runs on its own (stale "four") | 2, conflicting |
| 3 | yes | 8 | development-workflow.md#Workstreams | 1 |
| 4 | yes | 4 | technologies.md#AI services used | 1 |
| 5 | yes | 6 | engineering-principles.md#11 | 3 (also agent-coding.md, code-style.md) |
| 6 | yes | 5 | maintenance.md#Run when you touch the thing | 1 |

### After (2026-09-26)

| # | Found | Steps | Cited |
|---|---|---|---|
| 1 | yes | 6 | development/workflow.md#Workstreams |
| 2 | yes, now correct | 5 | development/workflow.md#Recurring work |
| 3 | yes | 3 | development/workflow.md#Commit provenance |
| 4 | over budget | 19 | secrets.md#Secret names, a second statement of the OpenRouter-only backend in the store's vocabulary; the navigator never tried `development/` for "technologies" |
| 5 | yes | 3 | engineering-principles.md#11 |
| 6 | yes | 6 | development/maintenance.md#Run when you touch the thing |

The AI-services list sits under "development", which is not where a reader
asking "which services does box data go to" looks; the security overview's
"What leaves your machine" is the reader-facing home for that question and
already points at the technologies page. Left as is; noted for the security
cluster.

### Cross-model review of the diff (Codex, 2026-09-26)

Two findings, applied: the recurring-work list, now the one doc-side
statement, disagreed with `schedules/*/schedule.yaml` (two jobs missing,
one cadence wrong) and is rewritten from the schedule files with
`bin/schedules list` named as the catalog; the parent restated the
agent-coding page's opening fact and now keeps only scope and pointers.
