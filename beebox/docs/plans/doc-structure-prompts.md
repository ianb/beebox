---
title: "Documentation structured like code: the prompt surface"
status: active
workstream: doc-structure
issues: []
---
# Documentation structured like code: the prompt surface

Sixth cluster under the [organizing principles](../README.md#organizing-principles):
the three pages about beebox's agent-facing prompt surface (the review
workflow, the lens catalog, prompt logging) become members of one `prompts`
subject. The pages already point at each other; the fixes are placement.

**Issues addressed:** none filed.

## Smallest fix and budget

Smallest fix: give the DOCID markers their own heading. Chosen: parent plus
three members, ~470 lines moved, ~40 rewritten, one manifest allowlist line,
about 30 hand-repaired references.

## Stated preferences this plan trades against

The principles as written.

## What already exists

The pilot's tooling; flat publish paths.

## Prior art (external)

None needed.

## Ontology

Members: review (the workflow and the layering model; `pnpm agent-context`),
lenses (the catalog a review pass hunts with), logging (`BBX_LOG_PROMPTS`,
DOCID markers, session JSONL). The prompt surface itself is generated code
(`src/core/agent-guide/`, the chat and reactor prompts, schema instructions,
skills content); the agent guide's section registry is the box-side analogue
of these principles and stays where it is.

## Tracks / scope

Placement problems found by the before-run (2026-09-25):

| Fact | Where it was | Why the walk failed |
|---|---|---|
| DOCID markers (`bbx init . --docid-debug`) | a `###` inside prompt-logging.md | nothing named "logging" suggests generated-doc markers; the navigator gave up after 15 steps |
| Two-timestamp cache freshness (`last_sync`, `data_through`) | a lens in prompt-audits.md | the navigator searched connectors and cards; the rule is a data-design lens filed among prompt lenses; nothing in `src/` implements it |
| Five review-lens principles (cost-per-bit, corrective framing, no archaeology, self-contradiction, examples do double duty) | prompt-surface-review.md "Principles" | restated lenses; the catalog is the home |

Target tree:

| Old | New |
|---|---|
| (new) | `prompts.md`: what the prompt surface is (the generated sources); members; owned elsewhere |
| `prompt-surface-review.md` | `prompts/review.md`; Principles keeps the structural rules and points at the catalog for lenses |
| `prompt-audits.md` | `prompts/lenses.md`; gains the three lenses the review page held alone; the cache-freshness lens is labelled as a data-design lens |
| `prompt-logging.md` | `prompts/logging.md`; DOCID markers become a top-level heading |

## Could this be simpler?

Leave the files flat and add the heading. The directory is the walkable name.

## Subplans

none.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Fact dropped in the move | section-hash check | zero missing before commit | clear |
| Skills and schedules cite old paths | no | repo-wide sed then grep, including test fixtures | clear once grepped |

## Agent-flow / user-flow edge cases

Stale ref: `doc-check`. Hand-edit drift: periodic review.

## NOT in scope

`model-policy.md` (a box configuration subject), the agent guide sources,
`knowledge-audits` (a testing instrument), the `bbx-context` skill.

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
| 1 | Which command renders the assembled context stack; how does it differ from `prompt-report`? | `agent-context` |
| 2 | The four layers and their loading classes? | `Identity prompt` |
| 3 | Why must the system prompt stay time-invariant; why is an edit invisible to an open thread? | `byte-identical` |
| 4 | Which env var captures API traffic; where do logs go? | `BBX_LOG_PROMPTS` |
| 5 | How to enable DOCID markers; which docs carry none? | `docid-debug` |
| 6 | The three places a session id appears? | `Session:` |
| 7 | Two timestamps a cache file carries; why not one? | `data_through` |
| 8 | The rule of thumb for a bloated prompt? | `30%` |
| 9 | Skill description vs body: loading and content? | `pure routing` |
| 10 | The guide/skill boundary as a rule? | `read vs. write` |

### Before (2026-09-25)

| # | Found | Steps | Cited | Locations |
|---|---|---|---|---|
| 1 | yes | 3 | prompt-surface-review.md#See the assembled context | 1 |
| 2 | yes | 3 | prompt-surface-review.md#The layering model | 1 |
| 3 | yes | 3 | prompt-surface-review.md#Invariants | 1 |
| 4 | yes | 3 | prompt-logging.md#Enabling Prompt Logging | 1 |
| 5 | **gave up** | 15 | (a `###` in prompt-logging.md) | 1 |
| 6 | yes | 5 | prompt-logging.md#Correlating Sessions | 1 |
| 7 | **gave up** | 15 | (a lens in prompt-audits.md) | 1 |
| 8 | yes | 3 | prompt-audits.md#Compactness | 1 |
| 9 | yes | 4 | prompt-surface-review.md#The layering model | 1 |
| 10 | yes | 3 | prompt-surface-review.md#The layering model | 1 |

### After (2026-09-26, before the review fixes)

| # | Found | Steps | Cited |
|---|---|---|---|
| 1 | yes | 5 | prompts/review.md#See the assembled context |
| 2 | yes | 5 | prompts/review.md#The layering model |
| 3 | yes | 5 | prompts/review.md#Invariants |
| 4 | yes | 9 | prompts/logging.md#Enabling it (tried chat and server first) |
| 5 | yes | 5 | prompts/logging.md#DOCID markers (was a give-up) |
| 6 | yes | 3 | prompts/logging.md#Correlating sessions |
| 7 | **gave up** | 18 | the lens catalog, again; the navigator searched connectors and cards |
| 8 | yes | 4 | prompts/lenses.md#Compactness |
| 9 | yes | 3 | prompts/review.md#The layering model |
| 10 | wrong | 11 | cited docs/README.md's restatement rule; the boundary was inline prose under "The layering model" |

Two placements were still wrong after the rewrite and are fixed with the
review findings below: the cache-freshness data convention now lives on
the connectors page ("Freshness metadata"), where every navigator looked
for it, with the surfacing half left as a lens that points there; the
guide/skill boundary and the skill description/body rule are subheadings
of the layering model.

### Cross-model review of the diff (Codex, 2026-09-26)

Four findings, all applied: the curated doc-graph table named two moved
files; the cache-freshness lens should move, not gain another heading;
the guide/skill boundary needs a heading; two visible link labels still
showed old filenames. The five moved principles were confirmed present
once each.
