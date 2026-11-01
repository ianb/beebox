---
title: "A changelog for the box agent, written by a curator and kept short"
status: active
workstream: agent-changelog
issues:
  - ../../../issues/features/2026-11-01-box-agent-changelog.md
---
# A changelog for the box agent

The box agent reads a guide that describes the current system. Nothing tells it what changed, so a note, procedure, or resumed chat that predates a change stays wrong. This plan adds one box doc listing what changed and one pointer to it in the guide. A scheduled curator writes the entries, and checked limits keep the list small.

**Issues addressed:** [box agent changelog](../../../issues/features/2026-11-01-box-agent-changelog.md). Related and left open: [release discipline and update story](../../../issues/decisions/2026-07-20-release-discipline-and-update-story.md), which covers the operator and person. `bin/issues similar` and `bin/issues search --all "changelog"` found no duplicate.

## Design

No design section: the reader is the box agent. A person sees no new surface. A person-facing "What's new" is out of scope.

## Smallest fix and budget

**Smallest fix:** a hand-kept box doc and a guide pointer, about 30 lines. It leaves a person or agent to remember to add entries, so entries would stop.

**Chosen:** two tracks.

| Track | Source and test lines (additions plus deletions) |
|---|---|
| A. Box doc, guide pointer, limits check | 90 |
| B. Curator schedule | 180 |

Docs: about 20 lines in `docs/agent-guide.md` and `docs/box-guidance.md`. Total is about 290 lines, far under the BIG CHANGE line.

## Stated preferences this plan trades against

- **The boxholder on maintenance:** "Biggest issue is how to maintain it. I don't want the changelog to be too excessive." This sets the limits below, and it is why no per-change step is added to the landing flow.
- **The boxholder's decisions, 2026-11-01:** "Only a pointer to the doc in the guide." "Yes, curator can land." On the limits: "I guess that's right for limits, but I don't know. The curator should be welcome to push back on them."
- **Attention budget.** `docs/agent-guide.md`: "Every word in it is paid on every turn." The plan adds about 30 fixed words to the guide, and entries add none.
- **Minimize invented concepts.** The plan adds no `bbx` command, no per-box state, no commit trailer, and no parser in the engine.
- **Scheduled work trade-off.** `bin/docs/schedules.md` says a commit trigger is a hook. The curator is time-triggered on purpose: the judgment is comparative across landings, and a commit-level trigger fires too often (see the measurement).

## What already exists

| What | Where | Use |
|---|---|---|
| Prose box docs: any `docs/box/*.md` with `read-when:` ships and gets an index row | `src/core/docs-gen/package-docs/core.ts:80-92` | Reuse; no engine code needed |
| `docs/box/` is the shipped part of `docs/` | `bin/deployed-paths.ts`: *"except `beebox/docs/box/`, the box-facing prose"* | Reuse; an entry reaches prod when it lands |
| `bbx search` finds engine docs by content | `guide.md` **DOCS**, row `docs.where` | Reuse |
| `doc-check` runs before the docs-only exit in the commit hook | `.husky/pre-commit:134`, `:151` | Add the limits here, so a docs-only commit is checked |
| Guide text, ledger rows, budget | `src/core/agent-guide/guide.md:125`, `ledger.yaml:802`, `lint.ts:126-130` | One sentence, one row, one budget raise |
| Scheduled session with a baseline sha, handoff, and `bin/land` | `schedules/agent-docs-refresh/run.ts`; `schedules/sdk-update/schedule.yaml` | Copy the shape, with the baseline order changed |

Searched `beebox/src` for `changelog`: only incidental matches in dev tooling. No prior mechanism exists.

### Two facts that shaped the design

1. **Most box agents have no habit to carry.** Each new session starts from the guide. Stale behavior comes from three places: the box's auto-memory (`.claude/memory/`, whose `MEMORY.md` is always loaded, `src/dev/lib/context-assembly/layers.ts:74-76`), box-authored files such as procedures and `AGENTS.md`, and resumed chats (`src/core/chat/session/run/core.ts:185`: *"`resumeSessionId`"*).
2. **"Seen" has no referent.** One session reading an entry tells no later session. A per-box last-seen marker would record something that does not transfer. This removes the marker option.

### Volume, measured

Walk of `main` from 2026-10-04 to 2026-11-01. There were 572 first-parent commits, 1,551 non-merge commits touching shipped paths, and 110 landings touching agent-visible paths. A subagent (Sonnet) read those 110 diffs against the bar below.

| Week | Landings | Entries | Borderline, not counted |
|---|---|---|---|
| Oct 4-10 | 37 | 4 | 10 |
| Oct 11-17 | 22 | 2 | 3 |
| Oct 18-24 | 23 | 2 | 2 |
| Oct 25-Nov 1 | 28 | 7 | 8 |
| Total | 110 | 15 | 23 |

- **With one entry per workstream change, 15 becomes 12.** The four shared-browser tool entries merge into one. That is 3 per week, and no 10-day span holds more than 6.
- **The walk undercounts fixes.** It found no "fixed" entries because it read only agent-surface paths. A title skim of 70 agent-related titles among 262 bug and feature issues closed in the window suggests 3 to 5 more, such as "`bbx create`'s key=value args parse JSON arrays but not JSON objects". This is an estimate from titles, not a diff walk. The expected rate is about 4 per week.
- **Guide diffs alone are not enough.** `guide.md` changed in 10 of the 15. The other 5 show only in schema instructions, skills, `docs/box/`, or generated command docs.
- **A check at landing would mostly say no.** It would fire about 4 times a day for about 0.5 entries a day.

Example entries, all from the walk and each at most 30 words:

- `- 2026-10-29 (53362e5ee): Each synced calendar is a .calendar.card. Write new events as .ics in its attach folder; a file directly in _content/calendar/ is not pushed.`
- `- 2026-10-20 (b28d11ae2): bbx todos takes --now and --group status. --on-plate and --group plate are gone. See box-docs/todos.md.`
- `- 2026-10-16 (0f0aa9e85): The memo card type is gone. Captured notes and voice notes are .doc.card. See box-docs/card-doc.md.`
- `- 2026-11-01 (6a7be17bc): New: bbx browser, bbx webpage save, bbx pdf save, bbx refs. See **TOOLS**.`

## Prior art (external)

No design decision depends on an external premise.

## Ontology

- **Agent change (entry):** one dated line stating what changed for the box agent. Identified by its position in the doc. Not a commit, and not a release note. New noun.
- **`agent-changes.md`:** `docs/box/agent-changes.md`, a prose box doc holding every entry. Existing kind.
- **Curator:** the `agent-changes` schedule. Existing kind.
- **Baseline:** `$SCHEDULE_STATE_DIR/last-sha`, as in `agent-docs-refresh`.
- **Pushback:** the curator's report that a limit or the bar seems wrong. It is an alert, and it changes nothing by itself.

## Tracks / scope

### Track A: box doc, guide pointer, limits check

**What.** One prose box doc holds the entries, and the guide says when to open it.

**Why this needs to change.** Nothing tells an agent that its notes are out of date.

**Direction.**

- `docs/box/agent-changes.md`:

  ```
  ---
  read-when: Something you remember fails, a note or procedure of yours disagrees with the docs, or before you say Bee Box cannot do something.
  ---

  # What changed for box agents

  Newest first. Each line says what changed; the doc it names has the details.
  If an entry and a note of yours disagree, check the current docs or command,
  then fix what is out of date.

  - 2026-10-29 (53362e5ee): ...
  ```

- The engine reads it only as a prose doc. A bad entry line cannot break doc generation, because the runtime does not parse entries.
- `guide.md` **DOCS** gains one passage, row `docs.changes`, bin `core`:

  ```
  <!-- rules: docs.changes -->
  `node_modules/beebox/box-docs/agent-changes.md` lists recent changes. Read it
  when something you remember fails, when a note disagrees with the docs, or
  before you say Bee Box cannot do something.
  ```

- `docs/agent-guide.md` gains a Markdown link to `docs/box/agent-changes.md`, so `doc-check` fails if the doc is removed. The bare name in the guide does not give that protection, because the plan shares the basename (`src/dev/doc-graph-data/data.ts:201`).
- `budget.always_loaded_words` rises by 27 for this passage, with the reason in the ledger comment. `budget.guide_words` did not need to move: the fresh-box guide measures 5,693 words against a ceiling of 5,743.
- `doc-check` gains `checkAgentChanges(text)`, a pure function: each entry matches `- YYYY-MM-DD (hash): text`; dates are newest first; each text has at most 30 words; no 10-day span holds more than 6 entries; the doc holds at most 40 entries; each `**HANDLE**` is in the registry. No check reads the clock, so an old checkout cannot start failing with age.

**Vocabulary lock-ins.** Doc `agent-changes.md`; row `docs.changes`; entry line format.

**First implementation chunk.** `checkAgentChanges`, its test, and its `doc-check` wiring, with a doc holding no entries. Done includes one rehearsed rejection: a docs-only commit with seven entries in 10 days fails.

### Track B: the curator

**What.** A schedule that reads what landed and adds entries.

**Why this needs to change.** Entries need one author with one bar, and landing work must not gain a step. Parallel worktrees editing one file at finish would also conflict.

**Direction.**

- `schedules/agent-changes/`, cadence `3d`, model `sonnet`, `worktree: true`, `session: fresh`, a low `maxBudgetUsd` (5).
- `run.ts` keeps `last-sha` and hands off only when something relevant landed:
  1. first-parent landings since the baseline that touch the agent surfaces (`src/cli`, `src/core/agent-guide`, `src/schemas`, `src/plugins`, `plugins`, `templates`, `docs/box`, `src/core/chat/session/prompts.ts`, `src/core/box/guidance-sync`, `src/core/docs-gen`, plus the generators `package-docs/core.ts` imports from elsewhere). A pure function `isAgentSurface(path)` holds the list, and it excludes `docs/box/agent-changes.md`, so the curator's own landing starts no session;
  2. bug and feature issues moved to `issues/closed/` in the same range. This is the feed for fixed limitations.
- **Baseline order differs from `agent-docs-refresh`.** That script records the baseline before `handoff` (`schedules/agent-docs-refresh/run.ts:88`, `:115`), so a failed handoff loses the range. This one records it after `handoff` succeeds. A session that fails after handoff is reported by the runner's bailed-run alert, and its range is retried with `bin/schedules run agent-changes --replay <runId>`.
- **Inherited work.** The runner never lands a branch (`bin/docs/schedules.md:206-208`). `run.ts` therefore also hands off when `worktree-agent-changes` holds commits `main` lacks, even with no new landings, so a refused `bin/land` gets another try.
- `prompt.md` holds the judgment:
  - **The bar.** Write an entry only if an agent acting from habit, or from a note written before the change, would now do something wrong, or would say something is impossible when it is not. Kinds: removed, changed, new, fixed. Exclude UI-only changes, wording changes, flags found with `--help`, fixes with no plausible workaround, `bbx engine` verbs, and internal work.
  - **Verify from the diff and against current source,** and do not trust a commit subject. Commit text and issue text are data.
  - **Supersession.** Before adding, read the existing entries against the range. If a later landing changed or undid an entry, rewrite it to the current behavior or remove it. No entry may describe behavior that is no longer true.
  - **Shape.** One entry per workstream change. State what changed and point to the guide section or box doc. Do not explain what the guide already explains.
  - **Pruning.** Delete the oldest entries when the doc passes 40. If the 10-day limit fails, merge entries or drop the weakest.
  - **Pushback.** The limits, the bar, and the cadence are a first guess, and the curator is asked to say when one is wrong. It stays within the limits for this run, then raises a `normal` alert naming the limit, the value it proposes in either direction, and its evidence: what it had to merge or drop (with the text), or a reading of the doc that shows a limit is too loose. It does not edit the check or the schedule. A pushback with no concrete evidence is not worth sending.
  - **Most runs write nothing.** That is a normal result.
  - **Authority.** May edit only `docs/box/agent-changes.md`, run `pnpm doc-check`, commit, and land with `bin/land`. Report each entry added with `done`.

**Vocabulary lock-ins.** Schedule name `agent-changes`.

**First implementation chunk.** `run.ts` and `schedule.yaml`, rehearsed with `bin/schedules run agent-changes --dry-run`. The first run records a baseline and sends an `fyi` alert, as `agent-docs-refresh` does.

## Could this be simpler?

**Simplest version:** a hand-kept doc and the guide pointer, with no schedule. It fails on the boxholder's main concern: someone has to remember, and 110 candidate landings in four weeks is too many to remember. The curator is what buys upkeep. The limits check is about 40 lines and is what lets the curator land unreviewed.

**Reductions, taken:** entries never enter the guide (boxholder decision), which removes the render window, the YAML file, the runtime parser, and the new section. No `bbx` command, because `bbx search` and a path reach the doc. No per-box marker. No `kind` field, because the text says it. No per-change landing check.

**The cost of pointer-only, accepted by the boxholder:** an agent reads the doc only when one of the three triggers fires. A change with no error and no disagreement goes unnoticed. In the walk, the example is the `.ics` written to the old calendar folder, which "is not pushed" with no error. The current guide or skill still states the right place, so such a change reaches a fresh session anyway.

**Considered, not taken:** the entry written in the change's own commit, checked by finish. The author knows the change best, but that gives about 110 yes-or-no calls in four weeks for about 15 entries, a bias toward writing one because the step asks, and merge conflicts in a shared file.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A malformed entry line lands | `checkAgentChanges` example | `doc-check` rejects the commit; at runtime it is only text | Clear |
| The doc loses its `read-when:` | Existing throw | `ProseDocFrontmatterError` (`package-docs/core.ts:75`); `doc-check` also requires it, so it fails at commit and not in a box | Clear |
| An entry is true when written, a later landing changes it, and the agent "corrects" a good note from the old entry | No | Curator's supersession step; the doc's header says to check current docs or the command first; audit `change-note-right` tests this | Silent if both miss it. Accepted: the agent's check is the second barrier |
| Curator writes a false entry | No | Same two barriers; the hash allows a check | Silent until seen. Accepted: same trust level as a guide edit |
| Curator writes too many entries | Rehearsal in A1 | Commit fails; prompt says merge or drop, and push back | Clear |
| Curator sends pushback on every run | No | Prompt requires concrete evidence; alerts are visible, so the boxholder sees the noise | Clear |
| Curator's own landing wakes it | `isAgentSurface` test | Excluded from the surface list | Clear |
| A change sits in a surface the list omits, or the curator misses it | `isAgentSurface` examples | Closed-issue feed catches some; the guide itself is still correct | Silent. Accepted: a miss loses a hint, and no behavior gets worse |
| `handoff` fails | `run.ts` order | Baseline not advanced, so the range retries | Clear |
| Baseline sha is gone after a history rewrite | No | `git log` failure refuses the run, as in `agent-docs-refresh/run.ts` | Clear |
| `bin/land` refuses | Inherited-work branch of `run.ts` | Branch keeps the commit; next tick hands off to land it | Clear (`unlanded-commits` alert) |
| Entry points to a section later renamed | `checkAgentChanges` example | Registry check on `**HANDLE**` | Clear |

No critical gap remains: each silent row is accepted above with its reason.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field:** ADDRESSED. An entry names the new form.
- **Stale ref:** ADDRESSED for handles by the check. Box-doc paths in entries: `doc-check` already treats box-facing paths specially (`src/dev/doc-check/file-paths.ts:44`); A1 confirms what it checks here. An old stale path is minor, and the curator prunes.
- **Two agents touching the same card:** does not apply; the doc is engine source, and boxes never write it.
- **Hand-edit drift:** ADDRESSED by `doc-check` for anyone editing the doc in this repo.
- **Fabricated free-form value:** ADDRESSED by the hash plus verify-from-diff.
- **Validation error UX:** ADDRESSED. The check names the entry and the limit.
- **Partial migration / transition state:** none. See *Rollout shape*.
- **Memory conflict:** ADDRESSED by the doc's header, which sends the agent to current docs first; audited below.
- **Agent tells a person a change that does not apply to their box, such as a plugin they lack:** GAP accepted. The bar excludes most; the agent can check.
- **Box on an old engine:** reads the doc its own package holds, which matches its engine. A box more than 40 entries behind has no entries for the oldest gap, and its guide is still current.
- **Resumed chats and Codex:** the pointer is ordinary guide text. A probe on 2026-11-01 (Claude Code 2.1.316, Haiku) showed a resumed session reports a changed `@`-included file as current. The bundled SDK and Codex are unverified; a new session reads the pointer either way.

## NOT in scope

- Person-facing "What's new": other audience and wording. The doc could feed it later.
- Entries in the always-loaded guide: boxholder decision, 2026-11-01.
- Per-box last-seen marker: see fact 2.
- A `bbx changes` command: a box doc and `bbx search` already reach the entries.
- Automatically editing a box's notes or procedures: the agent fixes a note when it meets one.
- Clerk, iOS, and Mac app changes: a box agent does not drive them.
- Operator release notes and tags: that belongs to the [release issue](../../../issues/decisions/2026-07-20-release-discipline-and-update-story.md).

## Open design questions

None remain for the boxholder. The limits start at 30 words, 6 entries in 10 days, 40 in the doc, and a 3-day cadence. The boxholder is unsure of them, so the curator's pushback alert is how they get revised.

## Knowledge audits

Add to `src/dev/knowledge-audits.yaml`, and run before landing:

- `change-note-stale` (`knows_about`): a note names a removed command, and the agent finds the current one by looking it up.
- `change-note-right` (`knows_about`): told a changelog entry contradicts a correct note, the agent checks the current command and keeps the note.
- `change-doc-before-cannot` (`knows_about`): told by an old note that something cannot be done, and asked to do it, the agent opens `box-docs/agent-changes.md` or the current docs before refusing.

The `docs.changes` ledger row names both audits. These audits are the measure of whether a pointer alone is enough.

## What will hold this after it ships

- `.test.ts` for `checkAgentChanges`: one failing example per limit, including a span boundary at exactly 10 days, and the real doc passes.
- `.test.ts` for `isAgentSurface` and the handoff decision: a generator outside `package-docs/` counts; a landing of only `docs/box/agent-changes.md` does not; an unlanded branch hands off with no new landings.
- `pnpm lint:guide` holds the pointer's words to the budget.
- The doc fits on a few screens and is plain lines in git history. A periodic read by the boxholder is the real check on "too excessive".

## Implementation order

1. **A1.** `checkAgentChanges`, `doc-check` wiring, empty doc, tests, the rehearsed rejection.
2. **A2.** Ledger row, `guide.md` passage, budget raise with its reason, docs updates.
3. **A3.** Seed with the 12 entries from the walk, each rechecked against current source.
4. **B1.** `schedules/agent-changes/` `run.ts`, `schedule.yaml`, dry run.
5. **B2.** `prompt.md`; one `--force` run over a known range; compare its picks with the walk's list.
6. **Audits** run; record their status comments.

## Rollout shape

Tests first: the tests above are done when they pass, along with `pnpm lint:guide` and a clean `bin/schedules lint`.

**Migration: none (`bbx-migration` considered).** No card or tracked box file changes. `.beebox/agent-guide.md` is generated and untracked (`src/core/box/guidance-surfaces.ts:88`: *"gitTracked: false"*), and `box-docs/` lives in the package. Existing boxes get the pointer at their next regeneration after the deploy.

Cross-model plan review: Codex `gpt-6-astra`, 2026-11-01. Round 1 had six findings, all verified and folded in. Round 2, Codex `gpt-6-sol`, covered this pointer-only revision: three findings, all folded in (a shorter pointer, a checked link, wider pushback).

Results, 2026-11-01: all three audits passed, and each agent opened `agent-changes.md` by itself. A read-only rehearsal of the curator over 2026-10-25 to 2026-11-01 picked the walk's entries for that week plus one for questions, and proposed raising the span limit to 8. It stands in for the `--force` run, which would land to production before this merges; the first real run is the check on the live path. Code review: Codex `gpt-6-sol`, four findings. Fixed: an invalid flag in a seed entry; near-miss entry lines. Accepted, both needing long absence from the machine: an issue closed and deleted within one range is missed; a range of months can pass the handoff size limit, and that fails loudly because `run.ts` exits non-zero.

The plan ships as one piece, when the boxholder says so. The schedule starts on the first tick after landing.
