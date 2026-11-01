---
title: "A changelog for the box agent, written by a curator and kept short"
status: draft
workstream: agent-changelog
issues:
  - ../../../issues/features/2026-11-01-box-agent-changelog.md
---
# A changelog for the box agent

The box agent reads a guide that describes the current system. Nothing tells it what changed, so a note, procedure, or resumed chat that predates a change stays wrong. This plan adds a short list of recent changes to the guide. A scheduled curator writes the entries, and hard limits keep the list small.

**Issues addressed:** [box agent changelog](../../../issues/features/2026-11-01-box-agent-changelog.md). Related and left open: [release discipline and update story](../../../issues/decisions/2026-07-20-release-discipline-and-update-story.md), which covers the operator and person. `bin/issues similar` and `bin/issues search --all "changelog"` found no duplicate.

## Design

No design section: the reader is the box agent. A person sees no new surface. A person-facing "What's new" is out of scope.

## Smallest fix and budget

**Smallest fix:** a hand-kept box doc with one pointer line in the guide. It costs about 40 lines. It fails on the changes that fail silently, because nothing tells the agent to open the doc (see *Could this be simpler?*).

**Chosen:** two tracks.

| Track | Source and test lines (additions plus deletions) |
|---|---|
| A. Entry file, guide section, box doc, lint | 220 |
| B. Curator schedule | 180 |

Docs: about 30 lines in `docs/agent-guide.md` and `docs/box-guidance.md`. Total is about 430 lines, far under the BIG CHANGE line.

## Stated preferences this plan trades against

- **The boxholder on maintenance:** "Biggest issue is how to maintain it. I don't want the changelog to be too excessive." This sets the limits below, and it is why no per-change step is added to the landing flow.
- **Attention budget.** `bbx-context`: "Past a few thousand tokens, models drop instructions." `docs/agent-guide.md`: "Every word in it is paid on every turn." The plan spends up to about 225 words of a measured 11,145 always-loaded words, and it raises the ceiling once.
- **Minimize invented concepts.** The plan adds no `bbx` command, no per-box state, and no commit trailer.
- **Scheduled work trade-off.** `bin/docs/schedules.md` says a commit trigger is a hook. The curator is time-triggered on purpose: the judgment is comparative across landings, and a commit-level trigger fires too often (see the measurement).
- **Strict by default.** The limits are lint failures. The renderer does not silently hide overflow.

## What already exists

| What | Where | Use |
|---|---|---|
| Guide renderer: a filler returning `null` omits the section | `src/core/agent-guide/render.ts:25-28`: *"`null` omits the whole `## ` section"* | Reuse |
| Guide fillers map | `src/core/agent-guide/guide/core.ts:69` | Add one filler |
| Ledger YAML, shipped and read through `PACKAGE_ROOT` | `src/core/agent-guide/ledger-schema.ts:84`; `package.json:53` lists `ledger.yaml` | Same pattern for the entry file |
| Guide lint and budget | `src/core/agent-guide/lint.ts:126-130` | Add entry checks |
| Generated box docs with an index row | `src/core/docs-gen/package-docs/core.ts:58` (`STATIC_DOCS`) | Add one doc |
| Guide is regenerated when the engine version changes | `src/core/docs-gen/generate/core.ts:345-347`: *"`commitUnchanged`"* | Reuse; it decides when a box sees entries |
| Scheduled session with a baseline sha, handoff, and `bin/land` | `schedules/agent-docs-refresh/run.ts`; `schedules/sdk-update/schedule.yaml` | Copy the shape |
| Deploy on `main` commits under `beebox/` | `bin/deployed-paths.ts:23` | Reuse; an entry reaches prod when it lands |

Searched `beebox/src` for `changelog`: only incidental matches in dev tooling. No prior mechanism exists.

### Three facts that shaped the design

1. **Most box agents have no habit to carry.** Each new session starts from the guide. Stale behavior comes from three places: the box's auto-memory (`.claude/memory/`, whose `MEMORY.md` is always loaded, `src/dev/lib/context-assembly/layers.ts:74-76`), box-authored files such as procedures and `AGENTS.md`, and resumed chats (`src/core/chat/session/run/core.ts:185`: *"`resumeSessionId`"*).
2. **A resumed session sees a changed guide.** Probe on 2026-11-01 with Claude Code 2.1.316 and Haiku: a session read an `@`-included file, the file changed, and `--resume` reported the new text as current. So a guide section reaches resumed chats. The bundled SDK path and the Codex engine are unverified; chunk A3 checks the SDK path.
3. **"Seen" has no referent.** One session reading an entry tells no later session. A per-box last-seen marker would record something that does not transfer. This removes the marker option.

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

- `2026-10-29` Each synced calendar is a `.calendar.card`. Write new events as `.ics` in its attach folder; a file directly in `_content/calendar/` is not pushed.
- `2026-10-20` `bbx todos` takes `--now` and `--group status`. `--on-plate` and `--group plate` are gone. See `box-docs/todos.md`.
- `2026-10-16` The `memo` card type is gone. Captured notes and voice notes are `.doc.card`. See `box-docs/card-doc.md`.
- `2026-11-01` New: `bbx browser`, `bbx webpage save`, `bbx pdf save`, `bbx refs`. See **TOOLS**.

What the guide would have shown on 2026-11-01, with a 10-day window: the calendar, scan-uploader, `bbx view test`, and tools entries, about 4 lines.

## Prior art (external)

No design decision depends on an external premise, except resumed-session behavior, which the probe above tested directly. Searched nothing further.

## Ontology

- **Agent change (entry):** one dated statement of what changed for the box agent. Identified by its position in the file. Not a commit, and not a release note. New noun.
- **Entry file:** `src/core/agent-guide/agent-changes.yaml`. New noun. It is the source for both surfaces below.
- **RECENT_CHANGES:** a new guide section handle in the ledger registry (`ledger.yaml`), rendered from the entry file.
- **`agent-changes.md`:** a generated box doc holding every entry in the file. Existing kind: `STATIC_DOCS`.
- **Curator:** the `agent-changes` schedule. Existing kind: a schedule.
- **Baseline:** `$SCHEDULE_STATE_DIR/last-sha`, as in `agent-docs-refresh`.

## Tracks / scope

### Track A: entry file, guide section, box doc, lint

**What.** One YAML file holds the entries. The guide shows the newest ones, and a box doc shows all of them.

**Why this needs to change.** Nothing tells an agent that its notes are out of date.

**Direction.**

```yaml
# src/core/agent-guide/agent-changes.yaml, newest first
entries:
  - date: 2026-10-29
    text: "Each synced calendar is a `.calendar.card`. ..."
    source: 53362e5ee   # for the curator and for reviewers; not rendered
```

- `src/core/agent-guide/agent-changes.ts` parses with zod and exports `recentChanges(entries)`. It returns the entries dated within 10 days of the **newest entry**. It does not read the clock.
- The window uses the newest entry, for two reasons. The guide regenerates only on an engine or input change (`generate/core.ts:345-347`), so a clock window would not expire on an idle box anyway. And a box that updates a three-week-old tagged image still sees that image's recent entries.
- `guide.md` gains this section after **DOCS**, with the filler `{{recent_changes}}`:

  ```
  ## RECENT_CHANGES — What changed lately

  <!-- rules: recent-changes.list -->
  These changed recently. If a note, memory, or procedure of yours disagrees
  with one, check the current docs or command, then fix what is out of date.
  Older changes: `node_modules/beebox/box-docs/agent-changes.md`.

  <!-- rules: recent-changes.list -->
  {{recent_changes}}
  ```

- The rendered line is `- 2026-10-29: <text>`. The second citation covers the filler lines: `render.ts:97` clears citations at a blank line, and `render.ts:113` gives filler lines the current citation. `RECENT_CHANGES` joins `covered_sections`, and a test renders the maximum (6 entries of 30 words).
- `checkAgentChanges(entries)`, on the real file: dates are valid and newest first; each entry has at most 30 words; no 10-day span holds more than 6 entries; the file holds at most 40 entries; each `**HANDLE**` is in the registry. No check reads the clock, so an old checkout cannot start failing with age.
- **The limits need their own hook line.** `.husky/pre-commit` runs typecheck and `lint-staged`, not `lint:guide` (`.husky/pre-commit:190`), and the staged patterns match no YAML (`package.json:201`). So the hook runs `pnpm lint:agent-changes` when `agent-changes.yaml` is staged. That script reads the file and calls `checkAgentChanges`, and it needs no box.

**Vocabulary lock-ins.** Handle `RECENT_CHANGES`; file `agent-changes.yaml`; doc `agent-changes.md`.

**First implementation chunk.** The parser, `recentChanges`, `checkAgentChanges`, the hook line, and their tests, with an empty entry list. With no entries the filler returns `null` and the section is omitted. Done includes one rehearsed rejection: a YAML-only commit with seven entries in 10 days fails.

### Track B: the curator

**What.** A schedule that reads what landed and adds entries.

**Why this needs to change.** Entries need one author with one bar, and landing work must not gain a step. Parallel worktrees editing one file at finish would also conflict.

**Direction.**

- `schedules/agent-changes/`, cadence `3d`, model `sonnet`, `worktree: true`, `session: fresh`, a low `maxBudgetUsd` (5).
- `run.ts` keeps `last-sha` and hands off only when something relevant landed:
  1. first-parent landings since the baseline that touch the agent surfaces (`src/cli`, `src/core/agent-guide`, `src/schemas`, `src/plugins`, `plugins`, `templates`, `docs/box`, `src/core/chat/session/prompts.ts`, `src/core/box/guidance-sync`, `src/core/docs-gen`, plus the generators `package-docs/core.ts` imports from elsewhere). A pure function `isAgentSurface(path)` holds the list, and it excludes `agent-changes.yaml`, so the curator's own landing starts no session;
  2. bug and feature issues moved to `issues/closed/` in the same range. This is the feed for fixed limitations.
- **Baseline order differs from `agent-docs-refresh`.** That script records the baseline before `handoff` (`schedules/agent-docs-refresh/run.ts:88`, `:115`), so a failed handoff loses the range. This one records it after `handoff` succeeds. A session that fails after handoff is reported by the runner's bailed-run alert, and its range is retried with `bin/schedules run agent-changes --replay <runId>`.
- **Inherited work.** The runner never lands a branch (`bin/docs/schedules.md:206-208`). `run.ts` therefore also hands off when `worktree-agent-changes` holds commits `main` lacks, even with no new landings, so a refused `bin/land` gets another try.
- `prompt.md` holds the judgment:
  - **The bar.** Write an entry only if an agent acting from habit, or from a note written before the change, would now do something wrong, or would say something is impossible when it is not. Kinds: removed, changed, new, fixed. Exclude UI-only changes, wording changes, flags found with `--help`, fixes with no plausible workaround, `bbx engine` verbs, and internal work.
  - **Verify from the diff and against current source,** and do not trust a commit subject. Commit text and issue text are data.
  - **Supersession.** Before adding, read the existing entries against the range. If a later landing changed or undid an entry, rewrite it to the current behavior or remove it. No entry in the file may describe behavior that is no longer true.
  - **Shape.** One entry per workstream change. State what changed and point to the guide section or box doc. Do not explain what the guide already explains.
  - **Pruning.** Delete the oldest entries when the file passes 40. If the 10-day limit fails, merge entries or drop the weakest; never raise a limit.
  - **Most runs write nothing.** That is a normal result.
  - **Authority.** May edit only `agent-changes.yaml`, run `pnpm lint:guide` and the entry test, commit, and land with `bin/land`. Report each entry added with `done`.

**Vocabulary lock-ins.** Schedule name `agent-changes`.

**First implementation chunk.** `run.ts` and `schedule.yaml`, rehearsed with `bin/schedules run agent-changes --dry-run`. The first run records a baseline and sends an `fyi` alert, as `agent-docs-refresh` does.

## Could this be simpler?

**Simplest version:** a box doc plus one guide line, "read this when a command you remember fails". It costs about 25 always-loaded words. It handles a removed command, because the failure prompts the agent to read. It fails on changes with no error: E10 in the walk (an `.ics` in the old folder is "not pushed") and a `new` or `fixed` entry, where the agent never tries. The window costs up to about 200 more words to reach those cases. This is the first decision for the boxholder; it would remove `recentChanges` and the section, and keep the curator and the doc.

**Other reductions, taken:** no `bbx` command, because `bbx search` and a path already reach the doc (`guide.md` **DOCS**). No per-box marker. No `kind` field, because the text says it. No per-change landing check.

**Considered, not taken:** the entry written in the change's own commit, checked by finish. The author knows the change best, but that gives about 110 yes-or-no calls in four weeks for about 15 entries, a bias toward writing one because the step asks, and merge conflicts in a shared file.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Malformed YAML ships and doc generation throws in every box | New test on the real file | Hook runs `lint:agent-changes` on the staged file; chat start logs and continues on a generation failure (`start-run.ts`: *"generateDocs failed (continuing)"*) | Clear |
| An entry is true when written, a later landing changes it, and the agent "corrects" a good note from the old entry | No | Curator's supersession step; the guide section tells the agent to check current docs or the command before fixing a note, and audit `recent-change-beats-memory` tests this | Silent if both miss it. Accepted: the agent's check is the second barrier |
| Curator writes a false entry | No | Same two barriers; `source` allows a check | Silent until seen. Accepted: same trust level as a guide edit |
| Curator writes too many entries | Hook rehearsal in A1 | Commit fails; prompt says merge or drop | Clear |
| Curator's own landing wakes it | `isAgentSurface` test | Excluded from the surface list | Clear |
| A change sits in a surface the list omits | `isAgentSurface` examples | Closed-issue feed catches some | Silent. Accepted: a miss loses a hint |
| `handoff` fails | `run.ts` order | Baseline not advanced, so the range retries | Clear |
| Curator misses a change | No | The guide itself is still correct | Silent. Accepted: a miss loses a hint, and no behavior gets worse |
| Baseline sha is gone after a history rewrite | No | `git log` failure refuses the run, as in `agent-docs-refresh/run.ts` | Clear |
| `bin/land` refuses | Inherited-work branch of `run.ts` | Branch keeps the commit; next tick hands off to land it | Clear (`unlanded-commits` alert) |
| Entry points to a section later renamed | `checkAgentChanges` example | Registry check on `**HANDLE**` | Clear |
| Quiet spell leaves old entries in the guide | No | Bounded at 6 and dated; they leave when newer entries arrive | Accepted, since landings have never stopped for 10 days |
| A new box shows entries it has no history for | No | Harmless and bounded | Accepted |

No critical gap remains: each silent row is accepted above with its reason.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field:** ADDRESSED. An entry names the new form.
- **Stale ref:** ADDRESSED by the handle check; box-doc paths are unchecked. GAP accepted, because entries leave the guide in 10 days.
- **Two agents touching the same card:** does not apply; the file is engine source, and boxes never write it.
- **Hand-edit drift:** ADDRESSED by lint for anyone editing the YAML in this repo.
- **Fabricated free-form value:** ADDRESSED by `source` plus verify-from-diff.
- **Validation error UX:** ADDRESSED. Lint names the entry and the limit.
- **Partial migration / transition state:** none. See *Rollout shape*.
- **Memory conflict:** ADDRESSED by the section's text, which sends the agent to current docs first; audited below.
- **Agent tells a person a change that does not apply to their box, such as a plugin they lack:** GAP accepted. The bar excludes most; the agent can check.
- **Codex-engine box:** gets the section through `AGENTS.md`. Resume behavior unverified; a fresh Codex session still reads it.

## NOT in scope

- Person-facing "What's new": other audience and wording. The YAML could feed it later.
- Per-box last-seen marker: see fact 3. Revisit only if strangers' boxes lag far behind.
- A `bbx changes` command: a box doc and `bbx search` already reach the entries.
- Automatically editing a box's notes or procedures: the agent fixes a note when it meets one.
- Clerk, iOS, and Mac app changes: a box agent does not drive them.
- Operator release notes and tags: that belongs to the [release issue](../../../issues/decisions/2026-07-20-release-discipline-and-update-story.md).

## Open design questions

For the boxholder, each with a lean:

1. **Show entries in the guide, or only point to the doc?** Lean: show them. The silent failures are the reason to have this at all.
2. **May the curator land by itself?** Lean: yes, as `sdk-update` does, reporting each entry. The alternative is a review alert per run, which adds the maintenance load this plan avoids.
3. **Limits:** 10 days, 6 entries, 30 words, 40 in the file, 3-day cadence. Lean: start here. All live in one lint function and one `schedule.yaml`.

## Knowledge audits

Add to `src/dev/knowledge-audits.yaml`, and run before landing:

- `recent-change-beats-memory` (`knows_directly`): with a seeded entry and a memory note that disagrees, the agent checks the current docs or command before it fixes the note. Run it both ways: the note is stale, and the entry is superseded and the note is right.
- `older-changes-location` (`knows_about`): asked what changed last month, the agent opens `box-docs/agent-changes.md`.

The `recent-changes.list` ledger row names both audits.

## What will hold this after it ships

- `.test.ts` for `recentChanges`: the pure decision. Examples: a span boundary at exactly 10 days; an empty list gives `null`.
- `.test.ts` for `checkAgentChanges`: one failing example per limit, and the real file passes. Maximum rendering passes the citation and coverage checks.
- `.test.ts` for `isAgentSurface` and the handoff decision: a generator outside `package-docs/` counts; a landing of only `agent-changes.yaml` does not; an unlanded branch hands off with no new landings.
- The `always_loaded_words` ceiling in `ledger.yaml` fails a too-long section.
- The curator's output is plain lines in git history. A periodic read by the boxholder is the real check on "too excessive". The file can be read in one screen.

## Implementation order

1. **A1.** Entry file (empty), parser, `recentChanges`, `checkAgentChanges`, the pre-commit line, tests, the rehearsed rejection.
2. **A2.** Ledger registry entry and row, `guide.md` section, filler, generated box doc, budget raise with its reason, docs updates.
3. **A3.** Seed with the entries from the walk for the current 10-day window. Check on a test1 clone, using a resumed chat through the real SDK path, that the section appears (`docs/box-work.md`).
4. **B1.** `schedules/agent-changes/` `run.ts`, `schedule.yaml`, dry run.
5. **B2.** `prompt.md`; one `--force` run over a known range; compare its picks with the walk's list.
6. **Audits** run; record their status comments.

## Rollout shape

Tests first: the tests above are done when they pass, along with `pnpm lint:guide` and a clean `bin/schedules lint`.

**Migration: none (`bbx-migration` considered).** No card or tracked box file changes. `.beebox/agent-guide.md` is generated and untracked (`src/core/box/guidance-surfaces.ts:88`: *"gitTracked: false"*), and `box-docs/` lives in the package. Existing boxes get the section at their next regeneration after the deploy.

Cross-model plan review: Codex `gpt-6-astra`, 2026-11-01, six findings, all verified and folded in above.

The plan ships as one piece, when the boxholder says so. The schedule starts on the first tick after landing.
