---
title: "Monorepo commits record no association with a workstream, issue, or plan — design from the questions, not the format"
workstream: commit-provenance
area: monorepo
needs: [design]
labels: [git, workstreams, issues, provenance]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder wanting structured commit metadata
resolution: implemented
---

> Closed: implemented by the commit-provenance-trailers plan. Resolving commits: `887f7a51` (script + hooks), `2fa2822c` (`bin/land --no-ff`), `8356dcd6` (review fixes), `77727b99` (CLAUDE.md convention).

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

Two of those are harness boilerplate. `Contract-Unchanged` is a gate, not a
facet: it exists only on the commits where `.husky/commit-msg` demanded it, so
it is not precedent for anything queryable. Nothing in `bin/` parses the monorepo's own
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
- the registry (`~/.cache/beebox/workstreams/<name>.json`) carries
  `baseSha` and, on removal, `finalSha`

At close time `/finish` writes "Resolved by `<sha>`" as prose at the top of the
issue body (`issues/CLAUDE.md`). That is the one moment the commit↔issue link
is known and recorded — unstructured, and only for issues someone remembered.

The box-side trailer vocabulary (`CONNECTOR_TRAILER_KEYS` in
`beebox/src/lib/git-trailers.ts`, facets in `git-log.ts`, filters in the
history router) is **not** this vocabulary — it records what a connector did to
a card. It is precedent only that trailers + a parser + a faceted reader work
in this codebase. This issue is about development history: who was working on
what, and why.

## Decisions (boxholder, 2026-08-24)

Design from the questions, and prefer anything that can be filled without a
human. Settled:

- **`Workstream:` — automatic.** A `prepare-commit-msg` hook stamps the bare
  name from the branch (`worktree-<name>` → `<name>`); commits on `main` get
  none. Nobody writes it, so it does not rot.
- **`Plan:` — automatic when derivable.** The hook finds plans whose
  frontmatter `workstream:` equals the branch's stream; if exactly one, stamp
  its bare name; otherwise omit. Never hand-written.
- **`Issue:` — optional, hand-written by the agent, bare name.**
  `Issue: 2026-08-20-slug` — no directory, no `.md` — because issues move
  between category dirs and into `closed/` and the link must survive that.
  `commit-msg` rejects a name that matches no file under `issues/**`
  (typo guard); absence is fine. May repeat for several issues.
- **`bin/land` switches to `--no-ff`** so `git log --first-parent main` shows
  one merge per landing and `<m>^1..<m>^2` lists what it brought.
- **No `/finish` enforcement** — the trailers describe, they do not police.

## The questions this answers

- *What did workstream X do?* — `git log --grep='^Workstream: X'`, or the
  landing merges. Durable after the branch is culled.
- *Did this fix land?* — `git log --grep='^Issue: <name>'` before falling back
  to the `git log -S` guess in `bbx-issue-actions`. Only catches commits that
  named the issue; a forgotten trailer degrades to today.
- *Which commits does this plan account for?* — `Plan:` grep, or via the
  stream.
- An open issue named by a landed commit is a closing candidate — the second
  question run in reverse, useful for queue sweeps.

## Cost

| Trailer | Writer | Failure mode |
|---|---|---|
| `Workstream:` | hook | hook not installed → blank, same as today |
| `Plan:` | hook | zero or several plans claim the stream → omitted |
| `Issue:` | agent, optional | forgotten (no regression) or wrong (permanent — commits are immutable) |

## Who reads it

1. `git log --format='%(trailers:key=Issue,valueonly)'` / `--grep` — free.
2. A small `bin/` query wrapping those, called by the `bbx-issue-actions`
   `fixed` disposition first.
3. The workstreams app shows no commits today (`git.tip` plus a `committed`
   boolean); a per-stream/per-issue commit list is a new panel. Later.

## Source of truth

Commits become the raw record for stream and plan (automatic, so
trustworthy). Issue `workstream:` frontmatter stays as intent/ownership; it is
no longer the only place the association lives.

## Retrofit

`git notes` could attach `Workstream:` to past commits using the 58 merge
commits and registry `baseSha`/`finalSha`. Only if someone asks about the past
after a reader exists.

## Still open

- Exact value for `Plan:` (bare filename of the plan doc).
- Where the hook lives (`.husky/prepare-commit-msg`, TS under `bin/`).
- Root `CLAUDE.md` wording for `Issue:` — every agent thereafter obeys it, so
  cross-model review before it lands.

## Related

- [No way to know what a workstream covers](../features/2026-08-20-no-way-to-know-what-a-workstream-covers.md)
  — answered from git by `Workstream:` and the landing merges.
- `bbx-issue-actions` skill, `fixed` disposition — the `git log -S` guess that
  `Issue:` grep precedes.
