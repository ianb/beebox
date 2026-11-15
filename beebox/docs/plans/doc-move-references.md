---
title: "Doc moves rewrite every reference and stage nothing"
status: draft
workstream: doc-move-references
issues:
  - ../../../issues/closed/bugs/2026-11-13-doc-move-and-issues-close-leave-stale-references.md
---
# Doc moves rewrite every reference and stage nothing

Three tools move a document: `bin/doc-move` (a plan at close-out), `bin/issues close`, and `bin/workstreams confirm-tested`. Each leaves some reference to the old path stale or leaves the git index half staged. This plan makes all three run one shared move in `bin/lib/doc-move.ts` that rewrites every path token naming the old file, refuses when it cannot, and leaves both indexes untouched, printing the exact `git add` line for each repository.

**Issues addressed:** `issues/closed/bugs/2026-11-13-doc-move-and-issues-close-leave-stale-references.md`. Related, decided separately: `issues/closed/docs-and-chores/2026-11-10-plan-move-at-close-out-rewrites-source-comments.md` (whether code should cite plans by path at all; see Open design questions). Prior art this must not undo: `issues/closed/features/2026-10-19-issue-close-is-manual-and-fix-rewrites-unrelated-files.md`, `issues/closed/code-quality/2026-10-10-doc-check-fix-misses-moved-file-paths.md`, `issues/closed/code-quality/2026-10-25-plan-move-leaves-stale-paths-in-test-comments.md`.

## Design

No design section: dev tooling only; nothing a box user sees changes.

## Smallest fix and budget

Smallest fix: in `rewriteReferences`, turn each "still names the old path" token into a rewrite, and call `git add` on the rewritten files after `git mv`. That fixes the two reported stale forms and the half-staged index, but it stages into an index other workers share, and leaves `confirm-tested` on its own path.

Chosen: one track in `bin/lib/doc-move.ts` plus its three callers.

- Library: residual tokens become rewrites when they resolve only to the moved file, link labels follow their target, a reference that cannot be rewritten refuses the move before any write, and the move uses a plain rename instead of `git mv` and returns per-repository stage lists and the files that were dirty before. About 120 changed lines.
- `bin/doc-move.ts`, `bin/issues-close.ts`: print the stage lines; exit nonzero on refusal. About 30 lines.
- `confirm-tested`: a TypeScript entry runs the shared move; the shell stages and commits the returned paths per repository and restores both on failure; `doc-check --fix` is gone from this path. About 80 lines.
- Tests: about 200 lines. Docs (`issues/AGENTS.md`, `.claude/agents/finish.md`, `bin/docs/worktree-lifecycle.md`): about 20 lines.

## Stated preferences this plan trades against

- Root `AGENTS.md`: "Parallel agents in one worktree share its git index: one agent commits, and the others return the paths to stage." A move that stages anything violates this; that decides stage-nothing.
- `bin/land:39-43`: a STAGED change in the main checkout blocks every landing, "a staged rename of an untouched file is enough". `git mv` in main does exactly that.
- Bias toward strict (developer memory): refuse rather than half-apply. Today ambiguous and residual references are printed as `check by hand` after the move is written.
- Prior art (2026-10-19 close): a move rewrites only references that resolve to the moved file, never by basename guess, and never runs `doc-check --fix`. `confirm-tested` still runs `doc-check --fix` (`bin/lib/manual-testing.sh:74`); this plan removes that.

## What already exists

- `planDocMove` / `moveDoc` / `formatDocMove`, `bin/lib/doc-move.ts`. Reuse; extend.
- `residualReferences`, `bin/lib/doc-move.ts:207`: already finds every path token ending in the basename that resolves to `from` from the file's directory, its package root, `beebox/`, or the repo root. Reuse its resolution as the rewrite rule.
- `relocateLinks`, `beebox/src/dev/doc-check/link-repair.ts:296`: rewrites link targets only; `mapLinks` keeps the label verbatim (`replacement = \`[${match[1] ?? ""}](${decision.to})\``, line 195). That is the stale-label bug.
- `findMentionsOf`, `file-paths.ts:243`: Markdown reads only backticked spans whose first segment is a repo directory (`candidatePath`, line 69). So `` `plans/secret-custody.md` `` (a label in `beebox/docs/secrets.md:6`) and bare prose (`canvas-loop/src/gallery/guitar-strings/task.md:1`) fall to the residual notice.
- `moveDoc` runs `git mv` (staged) then writes rewrites unstaged, `bin/lib/doc-move.ts:299-301`.
- `workstream_confirm_tested`, `bin/lib/manual-testing.sh:14`: edits content, plain `mv`, `git add`, `doc-check --fix`, `git commit --only`. It never rewrites inbound references, so the commit hook rejects a move that a plan's `issues:` entry names.
- `bin/deferred-issues.ts` moves issues out of `deferred/` with `doc-check --fix` and its own commit. Not one of the three; see NOT in scope.

## Prior art (external)

No decision depends on an external premise. `git add <deleted path>` stages the removal (git ≥ 2.0 default `--no-ignore-removal`), so a plain rename plus `git add -A -- old new` records the same rename `git mv` would.

## Ontology

- **Move**: one `.md` file from `from` to `to` in one repository. Exists: `DocMovePlan`.
- **Repository**: `public` (monorepo) or `private` (`private-issues/`). Exists: `Repository`, `repositoryOf`.
- **Rewrite**: one token changed in one file. Exists: `DocMoveRewrite`, kinds `link` | `path`. Adds kind `label` (link text) and `prose` (a path token outside links and backticks, or a form the scanners skip).
- **Notice**: exists, `DocMoveNotice`. Split by a new field `blocking: boolean`. Blocking: a reference to `from` that cannot be rewritten safely. Non-blocking: the moved file's own link to a missing file (pre-existing breakage the move preserves by path arithmetic).
- **Stage list**: new. `stage: Record<Repository, string[]>`, repository-local paths (private ones without the `private-issues/` prefix): old path, new path, and each rewritten file.
- **Dirty before**: new. `dirtyBefore: string[]`, repo-relative files in the move that had uncommitted changes (staged or not) before it wrote. Their stage line would sweep in someone else's edits.

## Tracks / scope

### Track 1 — every token naming the old file is rewritten or refuses the move

- **What:** after the existing link, frontmatter, and backticked-path rewrites, one pass over remaining tokens in each maintained file rewrites a token that names `from`.
- **Why:** link labels and prose paths stay stale (issue evidence: `chat-presence`, `canvas-brushes`), and every finish fixes them with `sed`.
- **Direction:** `residualReferences` becomes `rewriteResiduals({ rel, content, from, to, exists, scope })`. For each token from `tokensEndingWith` that contains `/` and is not followed by a path character (`a.md.bak`, `a.md/` are other paths): resolve it from each base (`dirname(rel)`, package root, `beebox`, `.`). Let `hits` be the distinct resolutions that equal `from` or exist. If `hits` is exactly `{from}`, replace the token with `relative(base, to)` for the first base that resolved it to `from`, keeping any `./` prefix out. If `hits` holds `from` and another file, add a blocking notice `ambiguous path`. `scope: "all"` for maintained files; `scope: "links"` for historical records (`isFilePathExempt`) limits the pass to link labels, reference definitions, and `href=` lines, the forms whose targets already follow. Kinds: `label` for a token inside an inline link's `[...]` (followed by `(`), else `prose`. In historical scope a reference definition's identifier (`[id]: target`) is never touched: renaming it would orphan its uses; `relocateLinks` already rewrites the target.
- **Privacy:** a public move whose moved file would link into `private-issues/` (`findPrivateLinkViolations`, `beebox/src/dev/doc-check/private-link.ts`) adds a blocking notice. Referrers cannot gain such a link: a public referrer is rewritten only to the public new path.
- **Refusal:** `moveDoc` throws `UnsafeReferencesError` listing every blocking notice (`path:Lline: message`) before rename or write. `--dry-run` prints them and exits 1.
- **Vocabulary lock-ins:** rewrite kinds `label`, `prose`; `DocMoveNotice.blocking`.
- **First chunk:** the pass, the refusal, unit tests in `bin/test/lib/doc-move.test.ts`.

### Track 2 — the move stages nothing and says what to stage, per repository

- **What:** `moveDoc` renames with `fs.renameSync` (after the tracked check) instead of `git mv`, and returns `stage` and `dirtyBefore`.
- **Why:** a worker's `bin/issues close` staged a rename that broke another worker's commit at doc-check (`web-guidance-scan` evidence), and a staged rename in main blocks `bin/land`. Staging everything together instead would still put one worker's files into the next worker's `git commit`.
- **Direction:** `dirtyBefore` from `git status --porcelain -z -- <paths>` per repository before any write. `formatDocMove` ends with:

  ```
  not staged; stage this move with:
    git add -A -- <public paths>
    git -C private-issues add -A -- <private paths>   # separate repository; commit there
  other uncommitted changes in: <paths>; stage those by hunk (git add -p)
  ```

  Only lines for a repository with paths appear. `bin/issues close --json` adds `stage` and `dirtyBefore`. Public files are never written to link into `private-issues/`: a public move reads private Markdown only to rewrite private files that link to it (`bin/lib/doc-move.ts:20-23`), and a private move reads only private files.
- **First chunk:** rename, stage lists, report text, a test in a temp repo with a private `private-issues/` repo inside it.

### Track 3 — confirm-tested uses the shared move

- **What:** `bin/confirm-tested.ts` gains `applyConfirmTested({ repoRoot, issue, date })`. When the issue closes, it calls `moveDoc` with `editMoved: (c) => confirmTestedContent(c, date).content`; otherwise it writes the edited content in place. It validates the workstream name and passes `refuseDirty: true`, so `moveDoc` refuses a dirty file in either repository before any write. It prints JSON `{ close, workstream, stage }`.
- **Why:** the 2026-11-15 re-encounter: the move skipped inbound rewrites, so the commit hook rejected it.
- **Direction:** the shell replaces the inline `node -e`, `mv`, and `doc-check --fix` with: run the entry, `git add -A -- <public>`, `git commit --only -- <public>`, then for private paths `git -C private-issues add -A` and `commit --only`. On failure before the public commit: restore only the move's paths (today's `git restore --worktree -- .` would also discard edits another process made in main after preflight), plus `git -C private-issues restore --staged --worktree -- <private>`, plus removal of the untracked target. A private commit failure after the public commit succeeded: report it with the private paths and leave them uncommitted (the public side is already consistent; the private files only hold link rewrites). The workstream name is read before the move from the original content, as today.
- **First chunk:** the entry, the shell change, the existing restore test adapted (failure now from a pre-commit hook that exits 23), and a new test where a plan's `issues:` entry names the issue and the commit succeeds with the rewrite.

## Could this be simpler?

The simplest version stages with `git add` inside `moveDoc` and leaves residual tokens as notices. It fails the reported parallel-worker case: the next worker's `git commit` takes the staged move with it, per the root `AGENTS.md` shared-index rule, and it fails `bin/land` in the main checkout. Converting residual notices to rewrites reuses an existing resolver; the only new rule is "exactly one target", which is the ambiguity rule `findMentionsOf` already applies (`file-paths.ts:266-270`).

`confirm-tested` could call `bin/issues close` as a process. It cannot: `closedSource` writes a closing note and resolution text different from `confirmTestedContent`, and `issues close` refuses an issue with `manual-testing` needs (`ManualTestingCloseError`). The shared layer is `moveDoc`, which both call.

## Plan review (codex gpt-6-astra, 2026-11-15)

Adopted: token boundary after the basename; refuse-before-write for dirty files and the workstream check in confirm-tested; rollback limited to the move's paths; inline-link labels only, never reference identifiers; a private-link check on the moved file.

Rejected: "confirm-tested must also stage nothing". Its purpose is the commit on a clean main checkout, called from the workstreams app; the shared move stages nothing and confirm-tested commits exactly the paths the move returns. Rejected: rollback of a write that fails midway, a mid-operation I/O window in a one-shot operator tool. Deferred to NOT in scope: the moved file's own prose self-paths.

## Branch review (codex gpt-6-astra, 2026-11-15)

Fixed: a public moved file's own frontmatter path into `private-issues/` now blocks the move (the link scanner saw only Markdown links); the label and prose pass skips box-facing docs, whose paths name box files (`file-paths.ts` `BOX_FACING_PREFIXES`). Rejected: confirm-tested staging (decided above; raised with the developer). Rejected: angle-bracket reference definitions in historical records (a form not found in the tree). Deferred: the moved file's own labels naming itself (NOT in scope, self-references).

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A prose token resolves to the moved file and to another existing file | Planned (adapt "A path token two files could answer to") | Refusal before write | Clear |
| A label in a historical record names the old path | Planned | `scope: "links"` rewrites it | Clear (printed) |
| A rewritten file already held another worker's edits | Planned | `dirtyBefore` line; confirm-tested refuses | Clear |
| Someone commits with `git commit -a` and loses the untracked new file | No | The printed stage line; docs updated | Silent until doc-check flags the missing file at that commit |
| confirm-tested public commit hook fails | Adapted existing test | Restore both repos | Clear |
| confirm-tested private commit fails after the public commit | No | Report the private paths | Clear |
| A token is rewritten inside a fenced code example | Planned (one fence line in fixture) | Rewritten: it names the moved file | Clear (printed) |

The `git commit -a` row is accepted: `git commit -a` is not the repo's commit idiom, and the next pre-commit doc-check reports links to the missing new path.

## Agent-flow / user-flow edge cases

- Wrong field: an agent stages with `git add -A` at the repo root instead of the printed line, sweeping others' files. ADDRESSED by printing a path-limited line; the habit itself is governed by the root `AGENTS.md` shared-index rule.
- Stale ref: a file changes between plan and write. Not handled; one-shot operator tool, window of milliseconds.
- Two agents: a parallel worker commits while a move's files are unstaged. ADDRESSED: the index is untouched, so their staged snapshot is unchanged.
- Hand-edit drift: a label spelled differently from the target (`plans/x.md` vs `../plans/x.md`). ADDRESSED: labels resolve by the same bases as prose, not by string equality with the target.
- Validation error UX: refusal lists each `path:Lline` and the token, and says to make the path unambiguous and rerun.
- Partial transition: none; no data shape changes.

## NOT in scope

- `bin/deferred-issues.ts` activation moves: they leave `deferred/` with `doc-check --fix` and commit in a dedicated run, not in a shared worktree; a move-aware rewrite there is a separate change.
- Whether code cites plans by path (issue 2026-11-10): an open developer decision; this plan keeps rewriting code citations until it is made.
- The moved file's prose naming its own path: both lifecycle destinations (`implemented-plans/`, `issues/closed/`) are historical records whose prose paths are not maintained (`scan-scope.ts` `FILE_PATH_EXEMPT_PREFIXES`).
- Teaching `doc-check --fix` the label and prose rules: `--fix` guesses by basename over the whole tree; extending its guess surface is what the 2026-10-19 close moved away from.

## Open design questions

Issue 2026-11-10 (plan moves rewrite code comments): (a) move the plan in the implementing commit, (b) cite plans from code by a stable name, (c) skip typecheck on comment-only diffs. Brought to the developer before implementation; lean (b). Track 1–3 do not depend on the answer.

## Knowledge audits

None: no new agent-facing concept in a box. Dev guidance changes (`issues/AGENTS.md`, `finish.md`) state the new stage line.

## What will hold this after it ships

Unit tests on `planDocMove` (pure, injected reads) for each new rewrite and refusal; one temp-repo test for rename, stage lists, `dirtyBefore`, and a nested private repo; the confirm-tested shell tests in a temp main checkout. No new test tier.

## Implementation order

1. Track 1 (rewrite pass, refusal) with tests. Commit.
2. Track 2 (rename, stage lists, report, both CLIs, docs). Commit.
3. Track 3 (confirm-tested). Commit.
4. Cross-model review of the branch; adjudicate.

## Rollout shape

Done when: `bin/test/lib/doc-move.test.ts` covers label, prose, historical-label, ambiguous refusal, stage lists for both repositories, and `dirtyBefore`; `bin/test/confirm-tested.test.ts` covers the inbound rewrite commit and both-repo restore; `pnpm typecheck` and `pnpm layout-check` pass from `beebox/`; lint passes on changed files. No migration.
