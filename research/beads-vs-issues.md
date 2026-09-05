---
title: "Beads vs. our issues/ queue — schema and tooling"
date: 2026-08-25
status: snapshot
---

# Beads vs. our `issues/` queue

Dated snapshot, 2026-08-25. Beads examined at commit `62d2119`
(github.com/steveyegge/beads, now `gastownhall/beads`; `CHANGELOG.md` top is
`[Unreleased]`, no tag in the shallow clone). Our side is `issues/CLAUDE.md`,
`bin/issues`, `bin/commit-provenance`, the `finish` agent, and the
`bbx-issue-actions` / `bbx-pick-issues` skills as of this date.

Scope, per the developer: the use cases are the same (an agent-shared queue of
work and tensions, worked mostly by agents, triaged by one person), so this
does not argue about purpose. It compares **schema** and **tooling**, with
emphasis on what is worth adopting. Storage is out: Beads moved from
JSONL-in-git to a Dolt database (each write is a Dolt commit; sync is
`bd dolt push/pull` over `refs/dolt/data`; `.beads/issues.jsonl` is "a
passive export"). We stay on markdown files in git. Beads' multi-agent
orchestration layer (molecules, formulas, gates, wisps, swarm, federation)
is orchestration, not tracking; one paragraph at the end.

## 1. Schema, field by field

Beads' `Issue` struct (`internal/types/types.go`) against our closed
frontmatter schema (`issues/CLAUDE.md`, parser
`workstreams-app/src/server/issue-domain.ts`).

| Concern | Beads | Ours | Same problem? |
|---|---|---|---|
| Identity | hash ID `bd-a1b2` (content-derived, no coordination across branches/agents) | date-slug basename, unique, enforced by `doc-check` | Yes, solved both ways. Our slugs are readable; theirs are typeable. No change. |
| Kind | `issue_type`: bug, feature, task, epic, chore, decision, spike, story, milestone (+ message/molecule/gate internal, + custom) | category directory: bugs, features, code-quality, docs-and-chores, decisions, exploration, watch | Close. Their `spike` = our `exploration` + `## Research (incomplete)`. Their `epic`/`milestone` have no counterpart — see §2.5. |
| Status | open, in_progress, blocked, deferred, closed, pinned, hooked; custom statuses with a category (active/wip/done/frozen) that decides `bd ready` visibility | open = in a category dir, closed = under `closed/`; everything else is derived from `needs:`/`next-action:`/`workstream:` | Theirs is a real state machine; ours is two states plus tags. Deliberate on our side (the queue is a parking lot, not a board). See §2.2 for `deferred`. |
| Priority | P0–P4, agent-settable, default P2 | important / normal / backlog / (omitted = uncategorized); **agents never set it** | Same field, opposite policy. Ours is a decided rule (`issues/CLAUDE.md`, "Agents do not set this field"). Keep. |
| Ownership | `assignee`, `owner`, plus a claim lease: `lease_expires_at`, `heartbeat_at`, `lease_granted_node`; status `hooked` while claimed | `workstream:` (bare name or `unattached`) | Theirs expires; ours doesn't. See §2.3. |
| Provenance | `created_by`, `discovered-from` edge, `caused-by` edge | `filed-by`, `discovered-by`, `discovered-in: worktree-<name> — context` | Ours is richer as *text* (who found it, who filed it, what they were doing). Theirs is a *link* to the parent issue. §2.4. |
| Relationships | typed edges: blocks, parent-child, conditional-blocks, waits-for (blocking); related, tracks, discovered-from, caused-by, validates, supersedes, duplicates, replies-to (annotations) | markdown links in the body; `labels:` for grouping; `design:` link to a plan | We have no machine-readable edges at all. §2.5. |
| Structured body | `description`, `design`, `acceptance_criteria`, `notes` as separate fields; `bd lint` checks required sections per type | free body with conventions: tension first, JTBD for features, `## Research (…)`, `## Manual testing` with a stable anchor | Their fields are our headings. §3.3. |
| Closing | `closed_at`, `close_reason`, `closed_by_session`; `bd duplicate --of`, `bd supersede --with` | `resolution: implemented \| wontfix \| superseded` + a closing note naming the commit/plan | Ours lacks a *target* for superseded/duplicate. §2.6. |
| Time | `due_at`, `defer_until`, `estimated_minutes`, `started_at` | none (date is in the filename) | Mostly no. `watch/` covers "not now" by trigger rather than by date. |
| External | `external_ref`, `source_system` (GitHub/Jira/Linear/Notion/ADO sync) | none | Not our problem; no external tracker. |
| Extension | `metadata` JSON blob, explicitly the extension point so the schema stays small | closed schema; unknown keys reported as `unknownKeys` | Same instinct (a small, policed schema), different escape hatch. Ours is `labels:`. Fine. |
| Memory decay | `compaction_level`, `compacted_at`, `original_size`; `bd admin compact` summarizes old closed issues | "closed items aren't interesting; delete in periodic sweeps" | Different problem: their issues are agent memory, ours are not. Reject. |
| Human gate | `bd human` lists "human-needed beads"; `type: decision` | `decisions/`, `needs: [decision]`, `next-action: discuss`, `needs: [manual-testing]` | We have more handles. Theirs is one list; ours is `bin/issues list --needs …`. Equivalent. |

Summary: the fields we lack that solve a problem we have are **relationships**
(§2.5) and **close targets** (§2.6). The fields we have that Beads lacks —
the seven `next-action:` dispositions, `needs: [manual-testing]` with the
re-encounter rule, the three-way provenance — are the parts of our system
that carry the human-in-the-loop lifecycle, and Beads has nothing comparable
(`bd close --reason` and `bd reopen` are the whole story there).

## 2. Lifecycle cases

### 2.1 Claimed fix → confirmation

Beads: close with a reason; reopen if wrong. No provisional state, no "code
landed but a human must exercise it" state, no rule for a second sighting.

Ours: `next-action: fixed` (provisional — verify then close), `manually-
confirmed` (authoritative), `needs: [manual-testing]` + `## Manual testing`
+ the headline blockquote, `verify-without-me`, and the re-encounter rule
("`manual-testing` + seen again = not fixed; agent removes the label").

Disposition: **nothing to adopt**. This is where our schema does the most
work, and it is all about the one human's attention, which Beads does not
model.

### 2.2 Stale and deferred

Beads: `bd stale --days N` (default 30, by `updated_at`); `bd defer <id>`
with optional `defer_until`, status `deferred`, excluded from `bd ready` and
default lists; `bd undefer`.

Ours: no notion of "touched recently" beyond `--since` on filing date;
`watch/` for "not actionable, revisit when an external trigger fires";
`priority: backlog` for "deliberately deprioritized". 329 open items.

The gap: we cannot ask "which open items has nobody touched in 90 days."
Filing date is a poor proxy (an old issue with a dated re-encounter note is
live). Git gives us last-modified for free.

Disposition: **reject** both (developer, 2026-08-25). Staleness is handled
by reading the queue and tagging `reconfirm`; a stale query would only feed
the same pass. `deferred` / `defer_until` lose to `watch/`, which is
trigger-based on purpose ("visit a watch item when its trigger lands … not
on a schedule"), and `priority: backlog` covers the rest.

### 2.3 Ownership and handoff

Beads: `bd update <id> --claim` is atomic; the claim is a lease with
`lease_expires_at` and `heartbeat_at`; status becomes `hooked`; an expired
lease makes the issue claimable again. This is the multi-agent answer to "an
agent died holding the work."

Ours: `workstream:` is set when a workstream "has taken responsibility"; a
worktree launched with `--issue` stamps it; `/finish` re-stamps the resolving
workstream. Nothing clears it if the worktree is culled without finishing.
`bin/workstreams sweep` reports orphaned worktrees and unmerged private
branches, not orphaned *ownership*.

Do we have the problem? Mildly. Sessions run one at a time under one person,
so a stale `workstream: foo` misleads `bin/issues list --workstream` and the
issues browser rather than blocking anyone. A lease/heartbeat is the wrong
size for that.

There is a second, sharper problem: the claim is not atomic.
`bin/lib/launch-session.sh:52` writes `workstream:` into the issue *inside
the new worktree*, so it lives on the branch until merge and main never sees
it; two launches can claim the same issue. Beads' `--claim` is a
compare-and-set (sets assignee to the actor, refuses if another actor holds
a live claim, idempotent for the same actor). Our atomic point has to be a
commit on `main`.

Disposition: **adapt**, twice. (1) `launch-worktree-session --issue` commits
the `workstream:` stamp to `main` before creating the worktree (a docs-only
commit, ~1s of hooks), refusing if the field already names a live
workstream; the in-worktree write goes away. (2) `bin/workstreams sweep`
lists open issues whose `workstream:` names a workstream with no worktree or
branch, resets them to `unattached`, and sets `next-action: reconfirm` so
they surface in the developer's normal pass — a dead owner is evidence the
issue's state is unknown. No new field, no lease.

### 2.4 Discovered work

Beads: `bd create … --deps discovered-from:<parent>`; AGENTS.md's landing
protocol step 1 is "file issues for remaining work." The edge is provenance
only (non-blocking).

Ours: `discovered-in: worktree-<name> — while doing X` plus `discovered-by`
and `filed-by`. `bin/issues groups --by discovered-in` clusters them. The
convention says the opposite of Beads about volume: "something you can just
fix, fix — don't file it," and "don't file trivia."

Our provenance is a workstream and a sentence; theirs is an issue ID. When
the trigger *was* an issue (found while working `2026-08-01-foo`), we write
that in prose, and `bin/issues similar` finds it by embedding rather than by
link. The link is better for one query — "what did working on X turn up" —
and worse for the common case, where the trigger is a task, not an issue.

Disposition: **adapt** into §2.5's relationship field rather than adding a
fourth provenance key; keep `discovered-in` as the primary record. **Reject**
the "file everything at landing" prescription; our filing rule is deliberate
and the queue is already large.

### 2.5 Dependencies, epics, clusters

Beads' central mechanism: `blocks` (+ `parent-child`, `conditional-blocks`,
`waits-for`) feed `bd ready`, "issues with no open blocking dependencies."
Epics are issues with `parent-child` children; `bd show` reports
`epic_closed_children / epic_total_children` and `epic_closeable`.

Ours: none. Clusters are re-derived every time (`bin/issues similar`, grep
by symbol, `groups --by labels`); a plan's "Issues addressed" header is the
only durable list, and it lives in the plan, not the issues. `labels:
[soft-launch]` is our epic. Ordering ("do A before B") exists only as prose.

Do we have the problem? Two halves:

- *Ready-work query*: no. The developer picks work; `bbx-pick-issues` is a
  proposal step, not a scheduler. An agent never asks "what is unblocked."
- *Durable grouping and ordering*: yes. Every `bbx-pick-issues` run rebuilds
  the same clusters; `/finish` forgets siblings that weren't listed in the
  plan; "B is a follow-up to A" is lost when A closes.

Disposition: **adapt**, the smallest version: two optional frontmatter
lists. Two rather than one untyped list, because ordering and grouping are
the one distinction we would query on:

```yaml
blocked-by: [2026-08-01-foo]          # do not start before these close
related: [2026-07-04-bar, 2026-08-10-baz]   # cluster / follow-up / found-while
```

Bare basenames, same rule as the `Issue:` commit trailer (issues move; the
basename is the stable key; `doc-check` already validates basenames). Then
`bin/issues show` prints the inverse edges (who lists me), `groups --by
related` becomes a cluster query, and `/finish` can reconcile "closed A, B is
`blocked-by` A" by noting it in B. Not `parent-child` (an epic is a label
here and that works), not `conditional-blocks`/`waits-for` (orchestration),
not `bd ready`.

Three Beads types and statuses the developer asked about resolve here
rather than as new categories:

- `milestone` — "marks completion of a set of related issues (no work
  itself)." It only means something with relationships: a milestone is an
  issue whose `blocked-by:` lists its members and closes when they all
  close. A use of the field, not a category.
- `pinned` — "a persistent bead that stays open indefinitely," protected
  from close, compaction and stale. Standing context for agents, not work.
  Ours lives in CLAUDE.md and docs; the queue is deliberately things that
  end. Not needed.
- `message` — inter-agent mail stored as beads (`sender` field; `bd mail`
  delegates to the Gas Town orchestrator). A mailbox, not a task. Our
  equivalents exist: `bin/comments` (human→agent) and each schedule run's
  report. Not needed.

This is a schema change to a closed schema, so it is filed as a decision,
not done here. The reason to say no: 329 items, most of which have no
relationships worth recording, and a field agents will pad. The reason to
say yes: the two queries above are ones we run by hand today.

### 2.6 Duplicates and supersession

Beads: `bd duplicate <id> --of <canonical>` closes the duplicate with a
`duplicates` edge; `bd supersede <old> --with <new>` closes with a
`supersedes` edge. Both keep the closed record pointing at the survivor.

Ours: search before filing, extend the existing item, never file a twin;
`next-action: duplicate` asks an agent to confirm; the close is
`resolution: superseded` (or wontfix with a note) — the *target* is prose in
the closing note.

Disposition: **adopt** a target on the resolution. Either
`resolution: superseded` gains a sibling `superseded-by: <basename>`, or the
`related:` list from §2.5 carries it. Same decision issue; the field is
worth having even if §2.5 is rejected, because "which issue absorbed this
one" is the question a reader of `closed/` actually has.

### 2.7 Closing with provenance

Beads: commit messages end with `(bd-xyz)`; `bd orphans` cross-references
open/in-progress issues against git history and lists "referenced in commits
but still open," with `--fix` to close them.

Ours: `Issue: <basename>` trailer, validated by a hook (a name matching
nothing under `issues/` blocks the commit — stricter than Beads, which has
no such check); `pnpm commit-provenance --issue <name>` finds commits;
`/finish` closes what the plan listed.

The trailer is better than the parenthetical (validated, greppable, multiple
per commit). The missing half is the inverse query: an open issue with
commits already citing it is either done-but-not-closed or partially
addressed, and nothing surfaces it today.

Disposition: **adopt** two things. `bin/issues orphans` (or `list --cited`):
open issues that appear in an `Issue:` trailer on `main`, with the commits;
no `--fix`. And a second trailer, `Resolves: <basename>` (optionally with
`implemented|wontfix|superseded`), so that closing is declared in the commit
that does it: `/finish` performs the `git mv` + `resolution:` from the
branch's trailers instead of from the plan's "Issues addressed" list, and
`commit-provenance` answers "what closed this" without reading the file. The
file move stays the status; the trailer is the input that drives it. The
existing trailer validator covers both.

### 2.8 Session start context

Beads: `bd prime` emits a workflow reminder from a SessionStart hook (about
50 tokens in MCP mode, 1–2k in CLI mode), overridable by `.beads/PRIME.md`,
specifically "to prevent agents from forgetting bd workflow after context
compaction."

Ours: `issues/CLAUDE.md` is loaded through the root `CLAUDE.md` pointer; the
skills carry the procedures; `bin/comments list --workstream` is the
pick-up-work step.

Disposition: **later**. The compaction-forgetting problem is real, but the
fix is a monorepo-wide session-start question, not an issues-tool question.
Note it; no issue.

### 2.9 Structure validation

Beads: `bd lint` and `bd create --validate` check for recommended sections
per type (a bug wants "Steps to Reproduce", etc.).

Ours: `doc-check` validates links and unique basenames; the parser reports
unknown keys; nothing checks that a `needs: [manual-testing]` item has a
`## Manual testing` section or that a `## Research (incomplete)` stub was
retitled with a date.

Disposition: **adapt** into `doc-check`, which already parses every issue's
frontmatter: `needs: [manual-testing]` ⇒ a `## Manual testing` section;
`closed/` ⇔ `resolution:`. No separate lint command (developer, 2026-08-25).
Not per-category required sections — the body conventions are judgment, and
STE-style prose does not want a template.

## 3. Tooling, side by side

| Job | Beads | Ours | Gap |
|---|---|---|---|
| Survey | `bd list`, `bd ready`, `bd blocked`, `bd stale`, `bd count`, `bd graph` | `bin/issues list/groups/search/similar/show` with filters on every frontmatter key; hybrid search | Ours is stronger for a human-triaged queue (facets, semantic similarity). Missing: stale (§2.2). |
| Hygiene | `bd stale`, `bd orphans`, `bd lint`, `bd doctor`, `bd find-duplicates` | `doc-check --fix` (link repair after moves), `unknownKeys` | Missing: orphans (§2.7), lint (§2.9). `find-duplicates` ≈ `similar`. |
| Work selection | `bd ready` + `--claim` | `bbx-pick-issues` (a procedure) | Different by design; no gap. |
| Disposition | `close --reason`, `reopen`, `defer`, `duplicate`, `supersede` | `bbx-issue-actions` over seven `next-action:` values; `git mv` to `closed/` | Ours is richer; missing a target on duplicate/supersede (§2.6). |
| Provenance | `(bd-id)` in message, `bd orphans` | `Issue:` trailer + hook validation + `commit-provenance` | Ours stricter; missing the inverse query (§2.7). |
| Agent context | `bd prime` on SessionStart | CLAUDE.md pointer + skills | §2.8, later. |
| Browser | none (CLI + `--json`; TUI via integrations) | `workstreams/issues/` facet browser, comments | Ours only. Consistent with "CLI is not a user surface." |

## 4. Dispositions

| # | Item | Disposition | Traced to |
|---|---|---|---|
| 1 | `bin/issues orphans` — open issues cited by `Issue:` trailers on `main`; `Resolves:` trailer driving `/finish` closes | **adopt** | `bin/commit-provenance.ts`; `finish` agent's close step; §2.7 |
| 2 | Stale-by-last-touch query | **reject** | developer, 2026-08-25: triage by reading + `reconfirm`; §2.2 |
| 3 | manual-testing and resolution invariants | **adapt** into `doc-check` | `issues/CLAUDE.md` rules that nothing enforces; §2.9 |
| 4 | `blocked-by:` / `related:` frontmatter lists (bare basenames) | **adapt — decision** | closed schema in `issues/CLAUDE.md` + `KNOWN_FRONTMATTER_KEYS`; `/finish` sibling reconciliation; §2.5 |
| 5 | `superseded-by:` target on closed items | **adapt — decision** (same issue as 4) | `resolution: superseded` has no target; §2.6 |
| 6 | Atomic `--issue` claim committed on `main`; sweep dead-workstream ownership → `unattached` + `reconfirm` | **adapt** | `bin/lib/launch-session.sh:52`; `bin/workstreams sweep`; §2.3 |
| 7 | Dolt / JSONL storage | **reject** | developer, 2026-08-25: "not going to make that change at this moment" |
| 8 | `deferred` status, `defer_until`, `due_at`, `estimated_minutes` | **reject** | `watch/` is trigger-based by design; `priority: backlog` |
| 9 | Agent-settable priority P0–P4 | **reject** | "Agents do not set this field" — the developer's attention budget |
| 10 | Claim leases / heartbeats / `hooked` | **reject** | git commit on `main` is the lock; #6 |
| 11 | Semantic compaction of closed issues | **reject** | closed items are not agent memory here; git history is the archive |
| 12 | Per-type required sections (`bd lint --validate`) | **reject** | STE body conventions are judgment, not template |
| 13 | "File issues for all remaining work" at session end | **reject** | "Something you can just fix, fix — don't file it"; 329 open |
| 14 | `bd prime`-style session-start reminder | **later** | monorepo session-start question, not an issues one; §2.8 |
| 15 | Molecules, formulas, gates, wisps, swarm, federation | **out of scope** | orchestration; our equivalents are workstreams, `schedules/`, `launch-worktree-session` |
| 16 | `pinned` status, `milestone` and `message` types | **reject** (milestone folds into #4) | §2.5 |

## 5. Filed

- `issues/features/2026-08-25-issue-provenance-trailers-and-orphans.md` — items 1, 3.
- `issues/decisions/2026-08-25-issue-relationship-fields.md` — items 4–5, 16.
- `issues/features/2026-08-25-atomic-issue-claim-and-dead-workstream-sweep.md` — item 6.
