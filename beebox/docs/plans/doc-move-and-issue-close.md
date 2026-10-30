---
title: "Move a tracked doc and rewrite every reference to it; close issues with one verb"
status: draft
workstream: tooling-burndown
issues:
  - ../../../issues/features/2026-10-19-issue-close-is-manual-and-fix-rewrites-unrelated-files.md
  - ../../../issues/code-quality/2026-10-25-plan-move-leaves-stale-paths-in-test-comments.md
---
# Move a tracked doc and rewrite every reference to it; close issues with one verb

Closing an issue and landing a plan are the same operation: move one tracked
Markdown file, then fix every reference to it. Today both are a `git mv`
followed by a whole-tree `doc-check --fix` and a hand `git grep`/`sed` pass.
This plan adds one move function that rewrites only references that point at
the moved file, a `bin/doc-move` entry for plans, and a `bin/issues close`
verb built on it.

**Issues addressed:**
[issue close is manual and --fix rewrites unrelated files](../../../issues/features/2026-10-19-issue-close-is-manual-and-fix-rewrites-unrelated-files.md),
[plan move leaves stale paths in test comments](../../../issues/code-quality/2026-10-25-plan-move-leaves-stale-paths-in-test-comments.md).
Searched (`bin/issues similar <path> --all` for both): the nearest closed
sibling is
[doc-check --fix misses moved file paths](../../../issues/closed/code-quality/2026-10-10-doc-check-fix-misses-moved-file-paths.md),
which added backticked-path and own-link repair to `--fix`. It did not add a
targeted move, and it kept tests out of scope. No other open duplicate.

## Design

No design section: developer tooling only; no box surface changes.

## Smallest fix and budget

Smallest fix for issue 2 alone: drop the `!p.endsWith(".test.ts")` filter in
`mentionSourceFiles` (`beebox/src/dev/doc-check/check.ts:104`). That fixes test
comments but keeps the whole-tree `--fix` that issue 1 names as the defect
(it rewrites unrelated files and runs another worker's uncommitted code), and
it lets a heuristic basename repair touch test fixtures.

Chosen: one shared move function (pure planner + thin I/O), two entry points.

- Track A, shared move: about 230 source lines (planner, I/O, CLI), about 120
  test lines.
- Track B, `bin/issues close`: about 120 source lines, about 80 test lines.
- Docs: `issues/AGENTS.md`, the `issues` skill, `bbx-issue-actions` closing
  mechanics, the finish agent's move/close steps, `bin/AGENTS.md`. Net shorter.

Total about 550 changed lines plus doc edits. Not a BIG CHANGE.

## Stated preferences this plan trades against

- Root `AGENTS.md`: *"Treat unsolicited tool output ... as a bug"* and the
  memory rule *bias toward strict*: the move refuses rather than guesses
  (existing destination, non-`.md` source, cross-repo move, an ambiguous
  issue name, `needs: [manual-testing]`).
- Memory rule *minimize invented concepts; prefer primitives*: reuse
  `git mv`, the existing link scanner in `link-repair.ts`, the existing
  path-mention scanner in `file-paths.ts`, `assignIssueWorkstream`
  (`bin/assign-issue-workstream.ts:29`), `workstreamFromBranch`
  (`bin/commit-provenance.ts:46`), and `resolveEntry`
  (`bin/issues-context.ts:163`).
- Root `AGENTS.md` on agent files: *"remove more than you add, move mechanics
  into a script the agent runs"*. The finish and issues doc edits shrink.
- Parallel finish-preflight work in another worktree edits the finish agent
  file; edits there stay inside the step 5 move sentence and the step 6 close
  paragraph.

## What already exists

- `repairLinks` (`beebox/src/dev/doc-check/link-repair.ts:170`): walks inline
  Markdown links, skipping fenced blocks and inline code
  (*"links inside inline-code spans or fenced code blocks are all left
  untouched"*, line 168). It decides per link by basename lookup. Reuse the
  walker; add an identity decision.
- `repairFrontmatterPaths` (`link-repair.ts:227`): the `design:`,
  `superseded-by:`, and `issues:` list fields. Reuse the walker the same way.
- `findFilePathProblems` / `findMovedPathMentions` / `repairFilePaths`
  (`beebox/src/dev/doc-check/file-paths.ts`): backticked repo paths in
  Markdown, and bare `.md` mentions in code and YAML (`MENTION_RE`, line 208),
  with `resolutionCandidates` (line 80) and `rewrittenFile` (line 89) for the
  token's style. Reuse; add a function that matches tokens naming one given
  file.
- Scan scope in `check.ts`: `GENERATED_NO_SCAN` (line 44),
  `FROZEN_SCAN_PREFIXES` (line 40), `FILE_PATH_EXEMPT_PREFIXES` (line 189),
  `isFilePathExempt` (line 200), `MENTION_SOURCE_RE` (line 101), and
  `AGENT_DOCS_PREFIX` (line 90, the `site/docs/` corpus whose links are
  relative to the published tree). `check.ts` runs at import, so these move to
  a new `scan-scope.ts` that both import. Rebuild nothing.
- `bin/deferred-issues.ts:236` `repairPrivateLinks` walks the private
  checkout's Markdown files itself (`markdownFiles`, line 109): the private
  repo has no doc-check gate.
- Closed-note precedent:
  `issues/closed/features/2026-10-28-web-live-recorder-closes-mic-after-idle.md:12`:
  *"**Closed (implemented, 2026-10-28):** landed in 629e7e8f1, ..."*.
- `resolveEntry` (`bin/issues-context.ts:163`) throws `AmbiguousIssueError`
  when a needle matches two or more issues.

## Prior art (external)

No decision depends on an external premise. `git mv` semantics are the only
external behavior used: it stages the rename and refuses an existing
destination.

## Ontology

- **Moved doc** — one git-tracked `.md` file (`git mv` needs it tracked), named by its
  repo-relative path (`from`) and its new path (`to`). Not a directory.
- **Reference** — a place in another file that names the moved doc's current
  path. Three kinds, all existing doc-check vocabulary: a Markdown `link`
  (inline `[text](target#anchor)`), a `frontmatter` path field, a `path` mention
  (backticked in Markdown, bare or backticked in code/YAML). A reference
  points at the moved doc when it *resolves to `from`* by the rule that kind
  already uses; never by basename.
- **Own link** — a relative Markdown link or frontmatter path inside the moved
  doc. Re-depthed: resolve against `from`'s directory, re-express from `to`'s.
- **Repository** — public (the monorepo) or private (`private-issues/`, a
  separate git repo mounted at the monorepo root). A move never crosses them.
- **Closing note** — the existing `**Closed (<resolution>, <date>):** <note>`
  paragraph after the frontmatter.

## Tracks / scope

### Track A — shared move (`bin/lib/doc-move.ts`, `bin/doc-move`)

**What.** A planner that, given `from`, `to`, the scanned file list, a reader,
and an existence test, returns the moved file's new content and per-file
rewrites. An applier that runs `git mv` and writes the files. A CLI.

**Why.** Every reference rewrite today goes through `--fix`, which scans the
whole working tree for any broken link (issue 1) and skips tests (issue 2,
`check.ts:98-105`: *"Tests are skipped: their fixtures name paths that must
stay as written"*). A move knows exactly which file moved, so it can match
references by identity, which is safe in tests too.

**Direction.**

- `beebox/src/dev/doc-check/scan-scope.ts`: the constants above, moved
  verbatim from `check.ts`, plus `isLinkScanned(rel)` (the `--fix` link scan's
  filter). Link scan, Markdown path scan, and code-mention scan keep their
  separate predicates.
- `link-repair.ts`: factor the line walker out of `repairLinks` and the field
  walker out of `repairFrontmatterPaths` (behavior unchanged), then add
  `relocateLinks({ resolveFrom, writeFrom, content, relocate })`: each relative
  link and frontmatter path is resolved from `resolveFrom`'s directory,
  `relocate` maps the resolved path to its new path (or leaves it), and the
  new target is written relative to `writeFrom`'s directory, anchor kept.
  Inbound use: both are the referrer; `relocate` maps `from → to`. Own-link
  use: `resolveFrom = from`, `writeFrom = to`, and every target keeps its repo
  path (`from` itself maps to `to`). Own links are re-depthed by path
  arithmetic even when the target does not exist, so a missing target keeps
  naming the same repo path; those are also listed on stderr.
- `file-paths.ts`: `findMentionsOf({ docRel, content, target, newPath, bare })`
  returns `moved` problems for each candidate token for which `target` is the
  only existing resolution candidate, with the suggestion built by
  `rewrittenFile`; the existing `repairFilePaths` applies them. A token for
  which `target` and another candidate both exist is an `ambiguous` finding:
  reported, never rewritten.
- Residual check: after the rewrite, every remaining token in a maintained
  file (link-scanned and not path-exempt Markdown, or a mention-scanned code
  file) that ends in the moved basename and resolves to `from` from the file's
  directory, package root, `beebox/`, or the repo root is reported on stderr
  as a reference the move did not rewrite (reference-style links, HTML
  `href`, `../`-relative mentions in code). doc-check is no safety net here:
  its graph resolves a stale inline link by basename
  (`beebox/src/dev/doc-graph-data/data.ts:223`).
- `bin/lib/doc-move.ts`, in `bin/` because a second beebox module importing the doc-check helpers would split `doc-check/` into units under layout rule 5:
  `planDocMove({ from, to, sources, read, exists, editMoved? }) → DocMovePlan` (pure) and
  `moveDoc({ repoRoot, from, to, dryRun, editMoved? }) → DocMovePlan` (I/O).
  `editMoved(content) => content` lets `close` set frontmatter and the note
  after own links are re-depthed. Scan set: public moves read every
  `git ls-files --cached --others --exclude-standard` `.md`/`.ts`/`.tsx`/
  `.mts`/`.yaml`/`.yml` file under `scan-scope` rules plus every
  `private-issues/` `.md` when mounted (a private file may link to a public
  one); private moves read only `private-issues/` `.md`. Private files that a
  public move rewrites are written and labeled in the output; they stay
  uncommitted in the private repo, and finish's private-leg gate
  (`git -C private-issues status --porcelain` empty) stops a landing until
  they are committed there. A cheap
  `content.includes(basename)` prefilter keeps the scan fast.
- Refusals (before any write): `from` missing, untracked, or not `.md`; `to`
  exists; `to` is in the other repository; `from === to`. `to` ending in `/` or naming an
  existing directory means `to/<basename>`.
- Output, one block per file, then a total:

  ```
  moved issues/features/x.md -> issues/closed/features/x.md
    L14 link ../bugs/y.md -> ../../bugs/y.md
  rewrote issues/bugs/z.md
    L9 link ../features/x.md -> ../closed/features/x.md
  rewrote beebox/test/foo.test.ts
    L3 path issues/features/x.md -> issues/closed/features/x.md
  private-issues (commit inside that repo): rewrote private-issues/bugs/q.md
    L5 link ../../issues/features/x.md -> ../../issues/closed/features/x.md
  3 reference(s) rewritten in 3 file(s)
  ```

  Own links whose target does not exist, ambiguous path tokens, and residual
  references go to stderr, one line each; exit 0, since the move itself
  succeeded and each line names the place to look.
- `bin/doc-move <from> <to> [--dry-run]`, a bash shim to `bin/doc-move.ts`.
  `git mv` stages the rename; rewritten files are left unstaged and printed.

**Vocabulary lock-ins.** `bin/doc-move`; `DocMovePlan { from, to, moved:
FileRewrite, files: FileRewrite[], unresolved }`, `FileRewrite { path,
repository, rewrites: { line, kind, from, to }[] }`.

**First chunk.** `scan-scope.ts` extraction plus the walker refactor in
`link-repair.ts`, with existing link-repair tests green.

### Track B — `bin/issues close`

**What.** `bin/issues close <issue> --resolution implemented|wontfix|superseded
--note <text> [--workstream <name>] [--dry-run] [--json]`.

**Why.** Issue 1: the close is five manual steps, and the last one (whole-tree
`--fix`) touches unrelated files.

**Direction.**

- Resolve `<issue>` with `resolveEntry` over all issues (public and private);
  an ambiguous name fails with `AmbiguousIssueError`.
- Refuse: already closed; under `deferred/`; `needs:` contains
  `manual-testing` (`issues/AGENTS.md`, Manual-testing lifecycle: *"Only the
  developer clears this"*); unknown `--resolution`; empty `--note`; more than
  one `--workstream`.
- Destination: `<root>/closed/<category>/<basename>`, where `<root>` is
  `issues` or `private-issues`.
- `closedSource(source, { resolution, workstream, note, date })` (pure, in
  `bin/issues-close.ts`): sets `resolution:` (replaces or appends before the
  closing fence), sets `workstream:` through `assignIssueWorkstream` when a
  workstream is known, and inserts `**Closed (<resolution>, <date>):** <note>`
  plus a blank line right after the frontmatter.
- Workstream: `--workstream` wins; else `workstreamFromBranch(current
  branch)`; else unchanged and printed as kept.
- The note is inserted after own links are re-depthed, so relative links in
  it are written from the closed location. A relative Markdown link in the note
  that does not resolve from there is a refusal before the move.
- Runs `moveDoc` with `editMoved = closedSource`.

**First chunk.** `closedSource` with tests, then the subcommand.

### Track C — guidance

`issues/AGENTS.md` "Closed items", "Titles + cross-links" and the Layout
reclassify line, the `issues` skill's close bullet, `bbx-issue-actions`
"Closing mechanics", finish agent step 5 (plan move) and step 6 (close), and a
`bin/AGENTS.md` line next to `bin/issues`. Each replaces a manual sequence with
the command; no new rules.

## Could this be simpler?

Simplest: let `--fix` scan tests (one-line change) and write a `close` that runs
`git mv`, edits frontmatter, then runs `--fix`. That fails issue 1 by
construction: `--fix` still rewrites every broken link in the tree, including
another worker's uncommitted files, and it still guesses by basename. The
identity match is what makes rewriting tests safe (a fixture path is only
touched when it names the moved file itself). A single move function shared by
the two entry points is the smallest shape that fixes both issues, per the
minimize-concepts rule: one operation, two callers already in the queue.

Also considered: making `doc-move` a `doc-check --move` flag. Rejected: a
mode that writes git state does not belong in the check script that pre-commit
runs.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A test fixture string names the moved file's exact path and gets rewritten | planned (planner test) | printed per line | clear (printed) |
| A reference to the moved file uses a form the scanner does not know (reference-style `[x]: path`, HTML `href`, `../` mention in code) | planned | residual check | clear (stderr) |
| Own link already broken before the move | planned | re-depthed by path, listed | clear (stderr) |
| `to` already exists / cross-repo / non-`.md` | planned | refusal before any write | clear |
| Ambiguous issue needle for `close` | existing `resolveEntry` tests | `AmbiguousIssueError` | clear |
| Backticked token where another resolution candidate also exists (`docs/x.md` beside `beebox/docs/x.md`) | planned | `ambiguous`, not rewritten | clear (stderr) |
| Private-repo referrers rewritten but not committed | planned (planner labels them private) | output label; finish's private-leg clean gate | clear |
| Two agents share the worktree; another's uncommitted file links to the moved doc | no | only that link is rewritten, and it is printed | clear |
| `git mv` fails after the plan is built (index lock) | no | no writes happen before `git mv`; error propagates | clear |
| A write fails after `git mv` (disk full) | no | none: the staged rename and earlier writes stay, visible in `git status` | clear |

No critical gap. The write-after-rename window is accepted: a one-shot
operator tool, and `git status` shows the partial state.

## Agent-flow / user-flow edge cases

- Wrong field: `--workstream` given twice — refused (ADDRESSED, Track B).
- Stale ref: a link that was already broken and only shares the basename is
  left alone; doc-check reports it (ADDRESSED, identity match).
- Two agents: see Failure modes; the move touches only files that point at the
  moved doc (ADDRESSED).
- Hand-edit drift: an issue missing `workstream:` fails
  `assignIssueWorkstream`'s `MissingWorkstreamFieldError` — refusal, since the
  field is required (ADDRESSED).
- Validation error UX: refusals go through `UsageError` subclasses in
  `issues-errors.ts`, printed as `issues: <message>` with exit 2 (ADDRESSED).
- Partial state: every refusal happens before `git mv`; only an I/O failure
  during the writes leaves partial state (Failure modes, last row).

## NOT in scope

- Deferred-issue activation (`bin/deferred-issues.ts:285`) keeps its whole-tree
  `--fix`: it runs inside a clean-tree transaction, so it cannot rewrite
  another worker's files. Switching it to `moveDoc` is a later cleanup.
- `doc-check --fix` keeps skipping tests; its basename repair is heuristic.
- Closing a deferred issue, reopening, and reclassify-with-rename stay manual
  (`bin/doc-move` covers a plain reclassify).
- Clearing a pending next action on close (`bin/issues next-action --clear`
  stays the separate step `bbx-issue-actions` already names).
- Re-depthing backticked doc-relative paths inside the moved file:
  `issues/closed/` and `implemented-plans/` are exempt from the file-path
  check (`check.ts:189`), and those paths are repo-rooted in practice.
- Moving several files in one call (plan plus its `.review.md`): callers run
  it per file; sequential moves compose.

## Open design questions

none open; the scan scope follows doc-check's scope exactly so a move produces
what doc-check enforces.

## Knowledge audits

Skip: dev-repo tooling. The finish agent and issues skill text change; a dev
knowledge audit is not warranted for a command substitution.

## What will hold this after it ships

- `bin/test/lib/doc-move.test.ts` (t.check, pure planner): an
  issue with sibling and cross-category own links moving into `closed/`; an
  inbound link from another category; a frontmatter `design:`/`issues:`
  entry; a `.test.ts` bare mention with a `:L12` suffix; a same-basename file
  elsewhere that must not be touched; a fenced/inline-code link left alone;
  an already-broken own link reported as unresolved.
- One temp-git-repo test of `moveDoc` (git mv happened, files written, refusal
  on existing destination).
- `bin/test/issues-close.test.ts` (t.check): `closedSource` on a typical issue,
  one with an existing `resolution:`, and refusal of `manual-testing`.
- Existing `link-repair.test.ts` and `file-paths.test.ts` hold the refactor.

## Implementation order

1. `scan-scope.ts` extraction, walker refactor (no behavior change).
2. `retargetLinks`, `findMentionsOf`, `planDocMove`, `moveDoc`, `bin/doc-move`,
   tests. Commit (issue 2 fix lands with chunk 4's doc edit).
3. `bin/issues close`, `closedSource`, tests. Commit.
4. Guidance edits. Real-run trial on a throwaway branch. Close both issues with
   the verb. Commit.

## Rollout shape

Done when the tests above pass, `pnpm typecheck`/`layout-check`/`doc-check`
pass, and a real trial close of an open issue with inbound links and relative
own links prints its rewrites and leaves `pnpm doc-check` green (trial
discarded). No data migration.
