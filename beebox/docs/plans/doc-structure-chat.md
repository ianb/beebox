---
title: "Documentation structured like code: the chat cluster"
status: active
workstream: doc-structure
issues: []
---
# Documentation structured like code: the chat cluster

Second cluster under the [organizing principles](../README.md#organizing-principles)
that the [testing pilot](../implemented-plans/doc-structure.md) established.
Seven flat reference docs about chat move into `docs/chat/` under a parent
`docs/chat.md`, one file per member, with the dated investigation material
frozen as a report. Same four-commit procedure as the pilot.

**Issues addressed:** none filed for this cluster. Related: the pilot's plan
listed this cluster as the next candidate.

## Smallest fix and budget

Smallest fix: leave the files flat and only remove the duplicated composer
"companion" cross-pointers. That fixes nothing a reader hits; the cluster's
problems are a 578-line procedure doc half made of dated investigation notes,
one lifecycle doc carrying two unrelated transcript subjects, and two composer
docs that split one member by aspect across files.

Chosen: one parent plus seven member files (~1,500 doc lines moved, ~150
rewritten), one report (~330 lines moved), one manifest allowlist line, and
about 40 hand-repaired references (code comments and non-unique basenames).
No source logic changes.

## Stated preferences this plan trades against

The principles in `docs/README.md`, applied as written. One judgment call the
boxholder allowed (2026-09-25): aspect headings are a default, longer or
member-specific headings are fine where they name the scope better.

## What already exists

Everything the pilot used: `doc-check --fix`, the section-hash script
(`scratch/doc-structure/section-hash.py`), the manifest allowlist pattern
(`site/docs-manifest.ts`), and the find-the-fact protocol. The site needs no
directory stub because every promoted chat page keeps a flat publish path.

## Prior art (external)

None needed; no decision depends on an external premise.

## Ontology

Members of the chat subject, in the code's own names: **session** (`ChatSession`,
`ChatThreadSession`, `src/core/chat/session/`), **history** (the transcript
and the acceptance record; session media), **schedules** (`<schedule>` timers,
`src/core/chat/schedules.ts`), **review** (the nightly pass,
`src/core/chat/review/`), **quick chat** (routing, `src/core/chat/routing/`),
**composer** (`composerMachine`, the rendered states), **scroll** (the
`useChatScroll` controller and its verification). No new nouns.

## Tracks / scope

Target tree and dispositions:

| Old | New | Notes |
|---|---|---|
| (none) | `chat.md` | parent: what chat is, the members table, facts owned elsewhere (engine per chat in model-policy, HTTP endpoints in the mobile contract), and the husk-card gap |
| `chat-session-lifecycle.md` "Phases", "The contract", "Shared code" | `chat/sessions.md` | |
| `chat-session-lifecycle.md` "Photos in a replayed conversation", "Two records of a message" | `chat/history.md` | transcript, acceptance record, session media |
| `chat-schedules.md` | `chat/schedules.md` | |
| `chat-review.md` | `chat/review.md` | |
| `quick-chat.md` | `chat/quick-chat.md` | basename shared with `box/quick-chat.md`; links repaired by hand |
| `composer-input-machine.md` + `composer-states.md` (+ `composer-states/` images) | `chat/composer.md` (+ `chat/composer/`) | one member; machine under How it works, the state map under States |
| `chat-scroll-testing.md` intro, harness, real-app procedure, images matrix, trace format, device checklist, the three repro scripts' commands | `chat/scroll.md` | the scroll model itself stays where it is maintained, the chat component's `CLAUDE.md`, and the plan; `scroll.md` points there |
| `chat-scroll-testing.md` dated sections (send-failure results, native reproduction, deeper web checks, controller fix verification, natural-sizing measurements) | `reports/chat-scroll-investigation-2026-09-04.md` | frozen |

Manifest: `beebox/docs/chat/` admitted; `chat-schedules`, `chat-review`,
`chat-session-lifecycle` keep their publish paths with new sources; `chat.md`
and `chat/history.md` are promoted; the two composer pages become one
`dev/composer.md`.

## Could this be simpler?

Leave `chat-scroll-testing.md` whole. It would keep 330 lines of 2026-09-04
measurements beside the procedure a reader needs today; principle 9 (history
is not reference) is the whole reason for the split.

## Subplans

none.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Fact dropped in the split or merge | section-hash check, chunk 1 | must be zero missing before commit | clear |
| Code comments still cite old paths | no | repo-wide grep after the move | clear once grepped |
| Composer screenshots break | no (doc-check ignores images) | relative paths move with the file; checked by reading the page in the doc browser | silent otherwise |
| Two public composer pages disappear | no | manifest edit is deliberate; noted | silent to external readers |

## Agent-flow / user-flow edge cases

Stale ref from an issue or plan: ADDRESSED by `doc-check`. Hand-edit drift:
GAP, same as the pilot; periodic review of recent docs is the boxholder's
chosen remedy.

## NOT in scope

The chat component's `CLAUDE.md` (an always-loaded agent file, out of this
workstream); writing a husk-card reference (a gap the parent names; new content
that needs verifying against code); the active `plans/chat-scroll-model.md`.

## Open design questions

none.

## Knowledge audits

Skipped: nothing box-loaded changes.

## What will hold this after it ships

`doc-check` for links; the periodic docs review for drift.

## Implementation order

1. Before-run of the find-the-fact questions below.
2. Chunk 1: moves, splits, merge, parent, manifest, link repair, hash check.
3. Chunk 2: aspect headings and restatement deletion.
4. After-run; Codex diff review; results here.

## Rollout shape

Done-when: `doc-check` and the site tests green, hash check zero missing,
after-run found on every question, one home per fact.

Questions (protocol as in the pilot plan):

| # | Question | Key string |
|---|---|---|
| 1 | Which duration units does the `in` attribute of `<schedule>` accept? | `s/m/h/d/w` |
| 2 | Where are web-chat schedules persisted? | `chat-schedules.json` |
| 3 | Quiet time and unread-span size for a session to qualify for review? | `6,000` |
| 4 | What happens to a hand-edited title on later review passes? | `manual` |
| 5 | Which secret does quick chat need, and what if it is missing? | `openrouter` |
| 6 | The composer machine's three regions and the two lifecycles it does not own? | `keyboard` |
| 7 | The scroll harness route and the function that runs every scenario? | `runAll` |
| 8 | Which endpoint serves a replayed chat photo, and the reference's parts? | `session-media` |
| 9 | Which lifecycle phase is ChatSession-only, and why? | `stopping` |
| 10 | The margin for a new conversation to beat an existing chat; ties? | `0.1` |

### Results (2026-09-25)

| # | Before: found / steps | After: found / steps | After: cited |
|---|---|---|---|
| 1 | yes / 3 | yes / 3 | chat/schedules.md#Agent sets a schedule |
| 2 | yes / 3 | yes / 4 | chat/schedules.md#Restart and lazy-hub behavior |
| 3 | yes / 3 | yes / 3 | chat/review.md#What qualifies |
| 4 | yes / 4 | yes / 4 | chat/review.md#Editing what it writes |
| 5 | yes / 7 | yes / 3 | chat/quick-chat.md#Requirements, data, and limits |
| 6 | yes / 3 | yes / 4 | chat/composer.md#Ownership |
| 7 | yes / 3 | yes / 4 | chat/scroll.md#The harness |
| 8 | yes / 6 | yes / 3 | chat/history.md#Photos in a replayed conversation |
| 9 | yes / 3 | yes / 4 | chat/sessions.md#Phases |
| 10 | yes / 3 | yes / 4 | chat/quick-chat.md#Destinations and preference |

This cluster was already navigable by file name; the gains are the two
questions whose facts sat under a misleading name (the secret requirement
under "Data and limits"; photo replay under "lifecycle"), and the removal of
330 lines of dated results from the live procedure. The extra step in most
after-run walks is `ls docs/chat`. Every fact has one home; the location
grep found no second full statement.

### Cross-model review of the diff (Codex, 2026-09-25)

Four findings, all applied: two references written one directory too
shallow after the move (one a real link in the frozen report, which
`doc-check` exempts under `reports/`); dated run results still inside the
scroll page's trace section, now moved to the report; the sessions page
stated facts above its first heading, now under "What it is"; the curated
doc-graph table still named the old schedules path.
