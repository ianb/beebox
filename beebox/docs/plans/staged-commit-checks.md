---
title: "Pre-commit checks run against the staged index"
status: active
workstream: tooling-burndown
issues:
  - ../../../issues/closed/code-quality/2026-10-10-pre-commit-checks-read-the-working-tree.md
  - ../../../issues/closed/code-quality/2026-10-25-layout-check-unit-directory-finding-found-late.md
---
# Pre-commit checks run against the staged index

The root pre-commit hook runs most checks against files on disk. A path-scoped
commit then fails, or passes wrongly, because of edits it does not include.
This plan runs those checks inside a persistent snapshot of the commit's index,
and makes the layout check's rule-5 finding name the import edges.

**Issues addressed:**
[pre-commit checks read the working tree](../../../issues/closed/code-quality/2026-10-10-pre-commit-checks-read-the-working-tree.md);
[layout-check unit-directory finding found late](../../../issues/closed/code-quality/2026-10-25-layout-check-unit-directory-finding-found-late.md).
Closed siblings checked with `bin/issues similar --closed`:
`issues/closed/bugs/2026-07-10-pathspec-commit-lint-staged-clobber.md` (the
`--no-stash` fix, kept), `issues/closed/docs-and-chores/2026-08-22-doc-check-skips-untracked-docs.md`
(doc-check also scans untracked docs; in the snapshot there are none, which is
the commit's truth), `issues/closed/code-quality/2026-10-16-layout-check-unit-message-omits-the-small-fixes.md`
(added the "import through the entry" hint; this plan adds the edges).

## Design

No design section: developer tooling; nothing a box user meets changes.

## Smallest fix and budget

Smallest fix for issue 1: make each disk-reading check read the index itself
(`git ls-files` plus `git cat-file --batch`). That covers our own TypeScript
checks but cannot reach `tsc`, `eslint`, `lint-staged`, `shellcheck`, or the
clerk generator, which read files by path. So the chosen design is one
snapshot directory that every check runs in, unchanged.

- Track A (snapshot): `bin/staged-snapshot.ts` (~150 lines) and its test
  (~120 lines); `.husky/pre-commit` edits (~40 lines changed); teardown
  removal in `bin/lib/worktree-teardown.sh` (~5 lines).
- Track B (layout-check): rule-5 message names edges (~30 lines), `--explain
  <dir>` (~60 lines), `lint:changed` runs layout-check (~20 lines), tests
  (~80 lines).
- Docs: root `AGENTS.md` "Commit and land", `bin/AGENTS.md` "Commit safety",
  `bin/docs/commit-guards.md` (net shorter in the two AGENTS files).

Total near 500 changed lines. Not a BIG CHANGE.

## Stated preferences this plan trades against

- Root `AGENTS.md`: *"keep docs-only commits fast"* is in the brief;
  `AGENTS.md:69`: *"Docs-only commits run fast doc, path-leak, and personal
  blocklist checks."* The snapshot adds a sync step to every commit. Measured
  below: ~0.12s warm, ~1.7s on the first commit after the snapshot is created.
- Boxholder memory "bias toward strict": fail closed. Any snapshot error aborts
  the commit (`set -e` in the hook).
- Boxholder memory "minimize invented concepts": one snapshot, no
  per-check index readers, no in-place fast path. The snapshot is always used,
  so the one code path is exercised on every commit.
- `AGENTS.md`: *"Write code in TypeScript"*. The snapshot helper is TypeScript;
  the hook stays bash.

## What already exists

- `.husky/pre-commit` — the dispatcher. Reuse; change only where it runs.
- Checks that already read the index, and stay as they are:
  `bin/precommit-security.ts:64` (*"execFileSync("git", ["show", `:${file}`]"*;
  but its shellcheck call at `:72` reads disk paths, which the snapshot fixes),
  `bin/commit-blocklist-check.ts:353` (*"["diff", "--cached", "-U0", "--no-color"]"*),
  `bin/doc-lifecycle-check.ts:89` (`--index` lists and reads `:path` objects),
  `bin/mobile-contract-check.ts:148` (staged names; it reads the contract doc
  from disk at `:177`, which the snapshot fixes).
- Checks that read the working tree today:
  - `bin/retired-product-name-check.ts:290,304,307` — `git ls-files` then
    `readFileSync(join(repoRoot, path))`, catching ENOENT: an unstaged
    deletion skips that file's staged content (a false negative) or shifts an
    allowlist count.
  - `bin/path-leak-check.ts:91` — `git grep -nIE` with no `--cached` greps the
    working tree, so a leak staged then reverted on disk passes.
  - `beebox/src/dev/doc-check/check.ts:72-73` — tracked docs filtered by
    `fs.existsSync`, so a staged doc deleted on disk is skipped; `:80` adds
    untracked docs; `:252` link targets resolved with `fs.existsSync`, so a
    link to an untracked file passes.
  - `beebox/src/dev/layout/scan/package/files.ts:47` —
    `ls-files --cached --others`, then `scan.ts:54` `readFileSync`: ENOENT on
    an unstaged deletion, untracked files count as units.
  - `bin/skill-lint.ts`, `bin/schedules lint`, `lint-staged`, `pnpm
    typecheck` (beebox, clerk, site, workstreams-app, root), `lint:bin`,
    `dev-apps-typecheck`, and the clerk contract gate, which writes
    `beebox-clerk/src/contract/clerk-contract.generated.ts` into the working
    tree and diffs it against the index.
- `bin/lib/worktree-paths.sh:36` *"WT_STATE_DIR="${BBX_STATE_DIR:-$HOME/.cache/beebox}""*
  — machine cache root; the snapshot lives under it.
- `bin/lib/worktree-teardown.sh:469-475` removes per-worktree cache state;
  snapshot removal joins it.
- Layout check: `beebox/src/dev/layout/check/rules/units.ts` `unitMessage`;
  `beebox/src/dev/layout/check/cli/main.ts` CLI; `bin/lint-changed.ts`
  `beeboxCommands` and `dispatchPlan`.

## Prior art (external)

- `git read-tree --reset -u <tree>` with a private `GIT_INDEX_FILE` updates a
  work tree incrementally using the private index's stat data (git-read-tree(1),
  "-u" and "--reset"). Adopted as a git primitive; no acknowledgement needed.
- Measured in this checkout (8,676 tracked files): `git write-tree` 0.04s;
  first `read-tree --reset -u` into an empty directory 1.7s; later passes
  0.12–0.13s; full `git checkout-index -a` 1.7–4.4s, 156 MB.
- Measured hook environment (scratch repo, git 2.45.2): a plain commit passes
  `GIT_INDEX_FILE=.git/index` (relative); `git commit -- <path>` passes an
  absolute `.git/next-index-<pid>.lock`; a linked worktree also passes
  `GIT_DIR`. So the hook must resolve the index before changing directory.
- lint-staged's own stash mode does the opposite (hides unstaged edits in the
  shared tree); rejected for the reason in
  `issues/closed/bugs/2026-07-10-pathspec-commit-lint-staged-clobber.md`.

## Ontology

- **Commit index** — the index `git commit` hands the hook in
  `GIT_INDEX_FILE`. Existing git concept. Its tree (`git write-tree`) is the
  content the commit records.
- **Staged snapshot** — a directory under
  `~/.cache/beebox/staged-snapshots/<basename>-<hash8>/` holding `tree/` (the
  commit index's files plus a `.git` file naming the checkout's git dir),
  `index` (a private index whose stat data matches `tree/`), `lock/` (held
  for the whole hook), and `toplevel` (the checkout path it serves).
  `<hash8>` is the first 8 hex digits of SHA-1 of the checkout's absolute
  top-level path. It is not a registered git worktree: no `git worktree add`,
  no branch, no entry in `.git/worktrees`.
- **Install links** — for each package directory with a tracked
  `package.json` whose real `node_modules/` exists, `tree/<pkg>/node_modules/`
  is a real directory of symlinks to the real entries. An entry that is a
  workspace link (it resolves inside the checkout, outside any
  `node_modules/`, for example `beebox/node_modules/@ianbicking/tap-check ->
  ../../../tap-check`) points at the snapshot's copy instead. Scope
  directories (`@ianbicking/`) that hold workspace links are rebuilt the same
  way; others link whole. External packages are the only working-tree content
  the snapshot exposes.
- **Captured tree** — the `git write-tree` id of the commit index when the
  hook started. The hook ends by checking that the commit index, the
  snapshot index, and the snapshot files still match it.
- **Snapshot environment** — cwd inside `tree/`, `GIT_INDEX_FILE=<snapshot>/index`,
  `GIT_OPTIONAL_LOCKS=0`, `GIT_DIR` and `GIT_WORK_TREE` unset. Git finds the
  repository through `tree/.git`, so tools that clear `GIT_DIR` and
  `GIT_WORK_TREE` (lint-staged does, `node_modules/lint-staged/lib/resolveGitRepo.js:41`)
  still see a repository whose work tree equals its index equals the
  captured tree.

## Tracks / scope

### Track A — run the hook's checks in a staged snapshot

**What.** A helper syncs the snapshot to the commit index and prints its
`tree/` path. The hook runs every check with that path as `REPO_DIR` and with
the snapshot environment exported, except the personal blocklist check, which
reads the gitignored `.commit-blocklist` from the real checkout and reads only
staged diffs.

**Why.** The retrospectives cite ENOENT on unstaged deletions, typecheck
failures on a sibling's half-edited file, doc-check failures on unregistered
docs, and one commit blocked by another agent's file (issue body). The
inventory above also shows holes in the other direction: doc-check skips a
staged doc deleted on disk, path-leak passes a leak that is staged but
reverted on disk, and doc links to untracked files pass.

**Direction.**

`bin/staged-snapshot.ts`, run as `node --import tsx bin/staged-snapshot.ts`
from the real checkout (inherits git's `GIT_INDEX_FILE`):

`bin/staged-snapshot.ts sync --owner <hook pid>`, run from the real checkout
(inherits git's `GIT_INDEX_FILE`):

1. Take `lock/` (`mkdir`, owner pid inside). A plain commit releases
   `index.lock` before pre-commit runs and rereads the index afterwards
   (git v2.45.2 `builtin/commit.c` `prepare_index`), so two plain commits in
   one checkout can run their hooks at once. Wait up to 120s for a live
   owner; take over a lock whose owner pid is dead; otherwise fail.
2. `tree = git write-tree` against the commit index. Unmerged entries or any
   git failure: throw, exit 1.
3. Resolve `<state>/staged-snapshots/<basename>-<hash8>/`
   (`<state>` = `BBX_STATE_DIR` or `~/.cache/beebox`). If `toplevel` is
   missing or names another checkout, remove the directory and start empty.
4. `GIT_INDEX_FILE=<snap>/index git --work-tree=<snap>/tree read-tree --reset -u <tree>`.
   This deletes files absent from `tree` and rewrites files whose stat changed
   (including a file a check edited last run).
5. `git clean -ffdqx -e node_modules` in the snapshot environment: removes
   every untracked and ignored file except install links, so build outputs
   (`beebox/dist/` declarations, `.wxt/`) never carry over from an earlier
   commit. Then write install links and `tree/.git`.
6. Print `<snap>/tree` and the captured tree.

`bin/staged-snapshot.ts finish --owner <pid> --tree <id> --index <commit index> --status <rc>`,
from the hook's EXIT trap: when `rc` is 0, fail unless `git write-tree` of the
commit index, `git write-tree` of the snapshot index, and the snapshot files
(`git diff --quiet` in the snapshot environment) all match the captured tree.
Always release the lock if this pid owns it. The check narrows the race with
another agent's `git add` to the moment between the hook's exit and git's
reread; it does not remove it. Fully atomic protection would need git to keep
the lock, which it does not offer.

The pure parts — the directory name, the link plan for one `node_modules/`
directory, and the lock decision — are exported for the test.

`.husky/pre-commit`:

- Resolve `GIT_INDEX_FILE` to an absolute path relative to the top level
  before anything else.
- Compute `staged`, `layout_staged`, `staged_schedules`, `staged_claude`
  from the commit index as today.
- Run `commit-blocklist-check` in the real checkout.
- Sync; install the EXIT trap; export the snapshot environment; set
  `REPO_DIR` to the snapshot. Every remaining check runs unchanged except two
  generated-input steps: the beebox branch runs `build:declarations` before
  the lint/typecheck pair (type-aware eslint resolves `beebox/plugins/*`
  through `dist/`, `beebox/package.json:24`, and would otherwise race the
  typecheck's own build), and the clerk branch runs `wxt prepare` before its
  pair (`beebox-clerk/tsconfig.json` extends `.wxt/tsconfig.json`).
  Measured: `build:declarations` 2.8s, `wxt prepare` 1.2s.
- The clerk gate's `git diff --exit-code` then compares the regenerated file in
  the snapshot with the snapshot index, which equals the commit index.
- `schedules/*/local.yaml` overrides are gitignored and absent from the
  snapshot (`bin/lib/schedules.ts:218` treats a missing file as no override).
  The schedule lint then validates committed content only, which is what the
  commit records.

Teardown: `bin/lib/worktree-teardown.sh` removes
`$WT_STATE_DIR/staged-snapshots/<name>-<hash8>` with the same path rule.

**Vocabulary lock-ins.** "staged snapshot" for the directory;
`bin/staged-snapshot.ts`; `~/.cache/beebox/staged-snapshots/`.

**First implementation chunk.** `bin/staged-snapshot.ts` and its test; hook
change; teardown line. One commit.

### Track B — layout check names the edges and runs earlier

**What.** The rule-5 (`unit-directory`) finding lists the import edges inside
the unit and the other entries in the directory. `pnpm layout-check --explain
<dir>` prints that directory's entries, each entry's exclusive helpers, and
the edges, so a planner can create a file (even a stub with its imports) and
see the unit graph before committing. `bin/lint-changed.ts` adds
`pnpm --silent layout-check` to its plan when a changed path (including a
deletion) is a code file or `package.json`.

**Why.** Issue 2: implementers find the edge by experiment, one blocked commit
at a time, and `lint:changed` does not run the check.

**Direction.** In `units.ts`, `unitMessage` gains `edges` (`importer ->
imported`, sibling basenames, sorted) and `others` (the other entries). The
message keeps its current text and appends `; edges: a.ts -> a-b.ts, ...;
other entries: x.ts, y.ts`. The `--explain` printer reuses the rule's
`checkDirectory` internals through one exported function
`explainDirectory(layout, dir)`. In `bin/lint-changed.ts`, a pure
`withLayoutCheck(commands, changed)` appends the command when the unfiltered
changed list needs it, unless the plan delegates to beebox's `lint:changed`,
whose child run adds it.

**Vocabulary lock-ins.** `--explain <dir>`.

**First implementation chunk.** Message edges plus test update; then
`--explain`; then `lint:changed`. One commit (issue 2), landed before Track A
so the snapshot track does not touch layout-check code at all.

## Could this be simpler?

Simplest version: per-check index reads in our own checks (doc-check,
layout-check, retired-name, path-leak `--cached`). It fails on the cited
typecheck case (a sibling's half-edited `.ts` fails `pnpm typecheck` at
commit), because `tsc` reads files by path. A second simple version: snapshot
only when the working tree differs from the index, run in place otherwise. It
keeps today's speed in the clean case but leaves the snapshot path unexercised
in most commits, and the warm snapshot costs only ~0.12s, so the single path
wins (minimal-concepts memory: two tiers of anything is a smell).

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `write-tree` fails (unmerged index) | yes (helper test) | throw → hook aborts | clear |
| Snapshot left with a file a check modified | yes (helper test: edit then resync) | `read-tree --reset -u` rewrites by stat | silent if broken → test |
| Snapshot left with a file or build output a check created | yes (helper test) | `git clean -ffdqx -e node_modules` | silent if broken → test |
| A tool needs an ignored input that is missing | real run of every hook branch | the two known generated inputs are regenerated (declarations, `.wxt`); others fail the check | clear when mandatory; silent when optional (`schedules/*/local.yaml`, intended) |
| `pnpm` refuses to run with the built `node_modules` | real run | none planned | clear |
| A workspace link left pointing at the real checkout | yes (link-plan test) | link plan repoints entries that resolve inside the checkout | silent if broken → test |
| A check stages or edits snapshot content | yes (helper test) | `finish` compares both indexes and the files with the captured tree | clear |
| Another agent stages during the hook (plain commit) | yes (helper test: change commit index, finish fails) | `finish` compares the commit index with the captured tree | clear; residual window after the hook exits |
| Two hooks in one checkout at once | yes (lock-decision test) | `lock/`, wait 120s, take over a dead owner | clear |
| Relative `GIT_INDEX_FILE` misread after `cd` | real run of a plain commit | hook absolutizes first | clear |
| Two checkouts share a basename | yes (path rule test) | `<hash8>` of the top-level path | — |
| Snapshot dirs accumulate (~156 MB each) | no | teardown removes it; main's persists | silent; one per live checkout |

## Agent-flow / user-flow edge cases

- Parallel agents in one worktree: ADDRESSED — each commit checks only its
  own commit index (Track A).
- `git commit -- <path>` with other staged paths: ADDRESSED — git's
  `next-index-*.lock` is the commit index the helper reads.
- An agent runs `pnpm typecheck` by hand: still reads the working tree. Docs
  say so (Track A docs).
- Hand-edited snapshot: rewritten on next sync by `--reset -u`.
- Validation error UX: check output names snapshot paths
  (`~/.cache/beebox/staged-snapshots/.../tree/beebox/src/x.ts`). GAP accepted:
  repo-relative tail is the same; the hook prints one line naming the
  snapshot so the prefix reads as expected.

## NOT in scope

- An external package that itself imports a workspace package (resolution
  from the real `node_modules/<pkg>` walks the real tree). Searched the
  installed tree: workspace links exist only in package-level
  `node_modules/@ianbicking/` directories.
- Making manual `pnpm typecheck`/`layout-check`/`doc-check` runs read the
  index: they answer "is my working tree good", a different question.
- `bin/finish-verify` and `bin/land`: they check committed trees already.
- A dry-run that simulates a not-yet-written file in memory: `--explain` on a
  stub file covers the planning case at a fraction of the cost.

## Open design questions

none

## Knowledge audits

Skip: purely infrastructural. The AGENTS.md text changes describe hook
behaviour; agents need no new procedure.

## What will hold this after it ships

- `bin/staged-snapshot.test.ts`: a temp repo with an unstaged deletion, an
  unstaged edit, an untracked file, and a staged edit; asserts `tree/` equals
  the index; then edits and creates files in `tree/`, resyncs, asserts they are
  gone; asserts the link list and path rule.
- `beebox/test/dev/layout/check/rules/units.test.ts` expected messages gain the
  edges; one case for `explainDirectory`.
- `bin/lint-changed.test.ts`: `withLayoutCheck` over the real dispatch plan
  (deletion only, `package.json`, mixed packages where beebox's child run owns
  the check, doc only).
- Real runs recorded in the report: path-scoped commit passing with unrelated
  unstaged deletion, half-written `.ts`, unregistered doc, and unstaged rename;
  a staged bad change still blocked; docs-only commit timed before and after.

## Implementation order

1. Track B (layout-check), commit with `Issue:
   2026-10-25-layout-check-unit-directory-finding-found-late`; close the issue.
2. Track A helper + test + hook + teardown, commit.
3. Docs (AGENTS.md, bin/AGENTS.md, commit-guards.md), close issue 1, commit.

## Rollout shape

Done when the tests above pass, `pnpm typecheck` and `pnpm layout-check` pass,
and the real-run matrix shows the expected outcomes. No data migration. The
first commit in each checkout after landing builds its snapshot (~2s).

## Plan review (codex gpt-6-astra, 2026-10-30)

Adopted: workspace links now point into the snapshot (finding 1); `tree/.git`
replaces `GIT_DIR`/`GIT_WORK_TREE`, which lint-staged clears (2); the hook
holds a snapshot lock and ends by comparing the commit index, snapshot index,
and snapshot files with the captured tree (3, 4); every ignored output except
install links is cleaned each sync, and declarations and `.wxt` are rebuilt in
the snapshot (5); layout selection uses the unfiltered changed list and one
layer owns it (6); optional ignored inputs are listed (7); the retired-name
citation is corrected (8).
