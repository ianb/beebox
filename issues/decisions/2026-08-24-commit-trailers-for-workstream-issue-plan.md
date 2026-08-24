---
title: "Monorepo commits record no association with a workstream, issue, or plan — design from the questions, not the format"
workstream: commit-provenance
area: monorepo
needs: [design]
labels: [git, workstreams, issues, provenance]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder wanting structured commit metadata
---

> I feel like we should have more structure in our git commit messages. Like
> trailers that show associations with workstreams, issues, plans, etc.

## What the monorepo's commits actually carry

Trailer keys across the last 400 commits:

```
290  Co-Authored-By
282  Claude-Session
  8  Contract-Unchanged
  1  Updated
```

Two of those are harness boilerplate. `Contract-Unchanged` is the only semantic
one, and it is read by exactly one thing (`bin/mobile-contract-check.ts`, as a
boolean gate in `.husky/commit-msg`). Nothing in `bin/` parses the monorepo's own
log or trailers; `bin/workstreams` reads diff/status shape only.

**Nothing records which workstream, issue, or plan a commit belongs to.**
17 of 300 commit bodies mention an issue path; none is queryable.

## Association is recoverable only by accident

`bin/land` is `--ff-only`, so a workstream's commits reach `main` carrying
nothing. The one signal is the `Merge branch 'main' into worktree-<name>`
commits `/finish` produces (58 in the last 400) — indirect, and gone for any
stream that never needed to merge main in.

Three files already try to record the same association, each written by hand
at a different moment, none able to speak about a specific commit:

- issues carry `workstream:` (~72% `unknown`/`unattached`)
- plans carry `workstream:` and `issues: []` (28 of 176 plans have a non-empty
  list)
- the registry (`~/.cache/callback-box/workstreams/<name>.json`) carries
  `baseSha` and, on removal, `finalSha`

At close time `/finish` writes "Resolved by `<sha>`" as prose at the top of the
issue body (`issues/CLAUDE.md`). That is the one moment the commit↔issue link
is known and recorded — unstructured, and only for issues someone remembered.

The box-side trailer vocabulary (`CONNECTOR_TRAILER_KEYS` in
`callback-box/src/lib/git-trailers.ts`, facets in `git-log.ts`, filters in the
history router) is **not** this vocabulary — it records what a connector did to
a card. It is precedent only that trailers + a parser + a faceted reader work
in this codebase. This issue is about development history: who was working on
what, and why.

## Design from the questions

Questions people actually asked of development history (observed in a clerical
session that spent hours on them, not invented here), what answering each
needs, and what it costs. The boxholder wants to cut this list before any
format is chosen.

### Q1. "What did workstream X actually do?"

Today: unanswerable once the branch is culled. **Needs** a durable per-commit
or per-landing mark on `main`. Two ways to get it, both fully automatic:

- **(a) `Workstream: <name>` trailer via a `prepare-commit-msg` hook.** The
  branch name `worktree-<name>` *is* the workstream, so the hook fills it with
  no human in the loop; commits on `main` itself get nothing (or `main`). Cost:
  one hook; one trailer on every commit; `git log --grep`-able forever.
- **(b) `bin/land` switches to `--no-ff`.** Then `git log --first-parent main`
  lists one merge per landing and `git log <m>^1..<m>^2` lists exactly what it
  brought — git's native answer, no trailer, no hook, retroactively readable
  for any stream that lands after the switch. Cost: merge commits on `main`
  (post-merge deploy hook already handles merges); one merge per checkpoint
  landing, so a stream can produce several.

(a) answers "which stream made *this* commit"; (b) answers "what did *this
landing* contain". They compose; (a) alone is the smaller change.

### Q2. "Did this fix actually land?"

Asked repeatedly. The `cb-issue-actions` skill's answer is `git log -S` on a
guessed string, written down as if it were a technique. **Needs** a
commit→issue link. Not derivable from the branch: the hook does not know which
issue a commit serves; the agent does (usually). Options:

- `Issue: issues/<cat>/<file>.md` trailer, written by the agent, **optional**,
  path-validated by `commit-msg` (rejects a path that does not exist — catches
  typos, costs nothing when absent). A forgotten trailer degrades to today.
  Cost: an instruction in root `CLAUDE.md`, a ~10-line hook check, and the
  standing risk that agents tag the wrong issue — permanently, since commits
  are immutable.
- Derive it per workstream instead: launcher `--issue` + issue `workstream:`
  frontmatter + Q1's stream mark. Answers "did the stream that owned this
  issue land anything" — weaker (72% of issues have no stream), but no new
  writing.

The failure case that hurt most — "fix landed inside a larger change in a
stream that never closed the item" — is only caught by the trailer.

### Q3. "Is this issue stale?"

Several old issues described things that had since shipped. **Partly**
answerable from Q2 (an `Issue:` trailer on any commit while the file is still
open is a flag). Not fully: work that fixes an issue nobody had in mind carries
no trailer. Beyond Q2 the honest tool is the heuristic already in the skill
(`git log --since=<issue date> -- <files the issue names>`). No trailer earns
its keep for this question alone.

### Q4. "Which commits does this plan account for?"

Plans carry `issues: []` by hand; nothing links either to commits. A plan is
almost always one workstream's plan, so **derive**: plan `workstream:` → Q1's
mark → commits. A `Plan:` trailer would be a third hand-written field agreeing
with two others; do not add it.

### Q5. `/finish` verifying what it merged matches what it claimed

If Q2's trailer exists, `/finish` can list the `Issue:` values across the
stream's commits and diff them against the plan's `issues:` list and the
issues it is about to close — surfacing "you committed against X but did not
close it" and "you are closing Y with no commit naming it". This is the
consumer that turns the trailer from ceremony into a check. Cost: a step in
the `finish` agent; a small `bin/` query.

### Cost table

| Question | Mechanism | Who writes | New ceremony per commit | Failure mode |
|---|---|---|---|---|
| Q1 stream | `prepare-commit-msg` hook | nobody | none (automatic) | hook not installed → blank, same as today |
| Q1 landing | `land --no-ff` | nobody | none | merge commits on main |
| Q2/Q3/Q5 issue | `Issue:` trailer, optional, validated | the agent | one line when relevant | wrong/forgotten tag; wrong is permanent |
| Q4 plan | derive via workstream | nobody | none | plan `workstream:` wrong |

## Who reads it

Name the consumer before the format. In order of cheapness:

1. `git log --format='%(trailers:key=Issue,valueonly)'` and `--grep` — free;
   enough for an agent answering Q2.
2. A `bin/` query (`bin/commits --issue <path>` / `--workstream <name>`) that
   the `cb-issue-actions` skill calls *before* falling back to `git log -S`.
3. `/finish` (Q5).
4. The workstreams app — it shows no commits today (`git.tip` and a
   `committed` boolean only), so a commit list per stream/issue is a new
   panel, not a filter on an existing one. Defer until 1–3 exist.

## Source of truth

Issues, plans, and the registry record association in three unsynchronized
files. Commits would be a fourth. The fork:

- **Commits become the raw record; files are derived or checked against it.**
  Q1 is automatic and therefore trustworthy; Q2 is declared and therefore
  checked (Q5). Issue `workstream:` stops being hand-maintained ownership and
  becomes "the stream whose commits name this issue" — or stays as intent,
  with Q5 flagging disagreement.
- **Files stay canonical; commits are a hint.** Cheaper, and the 72% figure
  says it does not work.

Recommendation: the first. Commits are immutable, so make the automatic part
(`Workstream:`) the thing derived fields lean on, and keep the declared part
(`Issue:`) optional but verified at `/finish`.

## Retrofit

`git notes` can attach `Workstream:` to past commits without rewriting; the 58
merge commits and registry `baseSha`/`finalSha` values reconstruct most streams
since the registry existed. Worth doing only once a reader (above) exists and
someone asks Q1 about the past. Not part of the first cut.

## Not decided here

The trailer names and value shapes (basename vs repo-relative path, one vs
many `Issue:` per commit) — after the list above is cut. The convention will
live in root `CLAUDE.md` and every agent thereafter obeys it, so cross-model
review before it lands.

## Related

- [No way to know what a workstream covers](../features/2026-08-20-no-way-to-know-what-a-workstream-covers.md)
  — the same missing association from the issue-queue end; Q1 answers it from
  git.
- `cb-issue-actions` skill, `fixed` disposition — the `git log -S` guess that
  Q2 replaces.
