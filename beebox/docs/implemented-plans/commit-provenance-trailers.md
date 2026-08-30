---
title: "Commit provenance trailers: Workstream / Plan / Issue"
status: implemented
workstream: commit-provenance
issues:
  - ../../../issues/closed/decisions/2026-08-24-commit-trailers-for-workstream-issue-plan.md
  - ../../../issues/closed/features/2026-08-20-no-way-to-know-what-a-workstream-covers.md
---

# Commit provenance trailers

Monorepo commits record which workstream and plan produced them, automatically,
and optionally which issue they serve. Landings on `main` become visible merge
commits. A small query wraps `git log` so agents answer "what did stream X do"
and "did this fix land" from history instead of guessing at `git log -S`.

The decisions behind the shape are in
`issues/decisions/2026-08-24-commit-trailers-for-workstream-issue-plan.md`.
This plan is the implementation.

## Stated preferences this plan trades against

- `beebox/docs/engineering-principles.md` — #3 validate at boundaries
  (the `Issue:` name is validated at commit time, the one boundary), #6
  resilient-not-silent (a missing hook degrades to today, and says nothing; a
  bad `Issue:` name blocks with a message), #9 derive over declare.
- Root `CLAUDE.md`: *"NEVER disable or weaken a lint rule"* — same posture for
  hooks: no `--no-verify` path is added; *"Treat noisy command output as a
  bug"* — the hook prints nothing on success.
- `beebox/code-style.md` — no default parameters, max two positional
  params, no `any`, for the TS in `bin/`.
- Precedent: `bin/mobile-contract-check.ts` + `.husky/commit-msg` — the one
  monorepo trailer already parsed by a hook. Its regex-per-line parse
  (`bin/mobile-contract-check.ts:93-99`) is the shape to reuse.
- Boxholder decision (issue, "Decisions" section): fill automatically wherever
  possible; `Issue:` is the only hand-written trailer and is optional; no
  `/finish` enforcement.

## What already exists

- **Hook shim.** `.husky/_/h` runs `.husky/<hook>` if the file exists;
  `.husky/_/prepare-commit-msg` is already present. Only the script file is
  missing.
- **Hook dispatch.** `.husky/commit-msg:20`: *`pnpm --silent
  mobile-contract-check --commit-msg "$1"`* — the commit-msg hook already
  calls a TS script with the message file. Reuse: add a second call. There is
  no `prepare-commit-msg` hook (`ls .husky/` → `commit-msg post-checkout
  post-commit post-merge pre-commit pre-push`); add one.
- **Trailer parse.** `bin/mobile-contract-check.ts:93-99` matches
  `^Key:` on *any* non-comment line of the message. Acceptable for an
  attestation; wrong for provenance — body prose such as "Issue: unclear"
  would become a trailer. Do **not** reuse it: parse with
  `git interpret-trailers --parse <file>`, which returns only the trailer
  block.
- **Branch → stream name.** `bin/lib/worktree-paths.sh` and the launcher
  create branch `worktree-<name>` (root `CLAUDE.md`: *"creates a managed
  worktree at `~/src/beebox-worktrees/<name>/` on branch
  `worktree-<name>`"*). The hook strips the prefix; nothing else needed.
- **Plan frontmatter.** `beebox/src/dev/doc-frontmatter.ts:22`
  `splitFrontmatter` and `:82` the `workstream` validation
  (*"frontmatter workstream must be a bare name, unattached, or unknown"*).
  Reuse `splitFrontmatter` to find the plan(s) claiming a stream. Plan dirs
  are enumerated at `beebox/src/dev/doc-check.ts:53-57` (`docs/plans/`,
  `docs/implemented-plans/`, `docs/unimplemented-plans/`). The hook reads
  **`docs/plans/` only**: `doc-frontmatter.ts:56-57` requires
  `unimplemented-plans` to be `superseded` or `parked`, and implemented plans
  are finished — neither may be stamped on new commits.
- **Landing.** `bin/land:169`: *`g merge --ff-only "$BRANCH"`*. Change to
  `--no-ff`. `bin/land:175` already says *"the post-merge hook handles deploy
  for deployed paths"*, and `.husky/post-merge` handles merges that update
  `main`, so deploy is unaffected.
- **Issue lookup by name.** `bin/launch-worktree-session:100-103` validates
  an issue *path* by regex. The `Issue:` validator needs a basename search
  under `issues/**` instead — new, ~10 lines.
- **The consumer to redirect.** `.claude/skills/bbx-issue-actions/SKILL.md:140`:
  *`git log --oneline -S'<a distinctive symbol or string from the issue>' --
  <path>`* — the guess this plan's query precedes.
- Box-side `beebox/src/lib/git-trailers.ts` / `git-log.ts` — a different
  vocabulary (connector actions on cards). Not reused; noted so nobody
  "unifies" them.

## Prior art (external)

- `git interpret-trailers --in-place --if-exists replace --trailer K=V` edits
  a message file idempotently — the right tool for a `prepare-commit-msg`
  hook, and it handles amend/reword without duplicating the trailer.
  https://git-scm.com/docs/git-interpret-trailers
- `prepare-commit-msg` receives a source argument (`message`, `template`,
  `merge`, `squash`, `commit`); the hook runs for `-m` commits too, so
  agents' `git commit -m` path is covered. https://git-scm.com/docs/githooks
- `git log --format='%(trailers:key=Issue,valueonly)'` (git ≥ 2.22; local is
  2.45.2) and `--grep='^Issue: name$'` are the free readers.
  https://git-scm.com/docs/pretty-formats
- `git notes` for retrofit without rewrite. https://git-scm.com/docs/git-notes
  Not in scope.
- Convention precedent: Gerrit `Change-Id:` (hook-stamped, immutable,
  queried) and Linux `Fixes:`/`Link:` trailers (hand-written, greppable).
  Both confirm: stamp what you can, keep hand-written keys few.
- No prior art found for deriving a "plan" trailer from doc frontmatter; it
  is a local mechanism.

## Tracks / scope

Ordered by dependency, then size.

### Track 1 — `prepare-commit-msg` stamps `Workstream:` and `Plan:`

**What.** `.husky/prepare-commit-msg` calls `bin/commit-provenance.ts
--prepare <msgfile> <source>`. The script reads the branch; if it matches
`^worktree-(.+)$`, it appends `Workstream: <name>` via `git
interpret-trailers --in-place --if-exists replace`. It then scans
`beebox/docs/plans/*.md` (active plans only; see "What already exists")
for frontmatter `workstream: <name>`; if exactly one matches, appends
`Plan: <bare filename without .md>`. On `main` or any other branch: no-op.

**Why.** `bin/land --ff-only` puts stream commits on `main` with no mark;
only `Merge branch 'main' into worktree-<name>` commits (58 of the last 400)
name a stream, indirectly. Once the branch is culled the association is gone.

**Direction.**
- Keys: `Workstream`, `Plan`, `Issue` (Title-Case, like `Contract-Unchanged`
  and `Co-Authored-By`).
- Values: bare names. `Workstream: commit-provenance`. `Plan:
  commit-provenance-trailers`. `Issue:
  2026-08-24-commit-trailers-for-workstream-issue-plan`.
- Source handling: stamp for every source except `squash` (`message`,
  `template`, `merge`, `commit`, and empty). A `Merge branch 'main' into
  worktree-x` commit is part of stream x and is stamped. `squash` is skipped:
  its message concatenates already-stamped messages, and stale inner
  trailers in the body would mislead more than a missing one.
- Silent on success (root `CLAUDE.md`, noisy output is a bug). Errors
  (cannot read branch, cannot parse a plan file) print one line to stderr and
  exit 0 — provenance must never block a commit (#6: the failure is loud,
  the commit proceeds; today's state is the fallback).
- Amend/reword: `--if-exists replace` keeps one trailer per key. A commit
  cherry-picked from stream A onto stream B keeps `Workstream: A` when git
  does not invoke the hook (plain `cherry-pick`), and is re-stamped to B if
  it does (`--edit`); either reading is defensible and neither is verified
  here — noted as a test case in Track 1.

**Vocabulary lock-ins.** The three keys and bare-name values above. Stated in
root `CLAUDE.md` in one paragraph (Track 4).

**First implementation chunk.** `bin/commit-provenance.ts` with `--prepare`,
unit tests for branch parsing, plan resolution (0 / 1 / many), and
idempotence on a message that already carries the trailers; the husky hook
file. The Track 4 doctest also exercises real `git commit` under `-m`, the
editor template with `#` comment lines (trailer must land above them —
probed: `interpret-trailers` inserts before the comment block), `--amend`,
and `--cleanup=scissors`. No open questions.

### Track 2 — `commit-msg` validates `Issue:`

**What.** `.husky/commit-msg` gains a second line: `pnpm --silent
commit-provenance --check <msgfile>`. The script reads every `Issue:` trailer
via `git interpret-trailers --parse`; for each value, looks for
`issues/**/<value>.md` (recursive, includes `closed/`). **Public issues only:**
`private-issues/` is never searched — a private slug in public history is a
leak (root `CLAUDE.md`: public files must never link into it), so a commit
serving a private issue carries no `Issue:`. Any miss blocks the commit with
the bad name and the nearest basenames (prefix match on the date + first
word) so a typo is a one-edit fix.

**Why.** Commits are immutable; a misspelled `Issue:` is a permanent dangling
link, and `git log --grep` will never find it. This is the one boundary
(#3).

**Direction.** Block only on a name that matches nothing. Do not block on
zero `Issue:` trailers (optional by decision). Do not block on a name that
matches several files (two categories cannot share a basename; `closed/`
moves preserve it — treat several as one). Message format mirrors the
mobile-contract block: what was wrong, the fix.

**First implementation chunk.** `--check` mode + tests (found in open,
found in closed, not found, `Issue:` in body prose ignored, path/`.md` form
blocked). No open questions.

### Track 3 — `bin/land --no-ff`

**What.** `bin/land:169` becomes `g merge --no-ff --no-edit "$BRANCH"`. The
merge-ready check (`bin/land:76-77`, branch contains main and is ahead)
stays, so history remains linear-per-stream with one merge per landing.

**Why.** `git log --first-parent main` then lists landings; `<m>^1..<m>^2`
lists what each brought. Answers "what did this landing contain" with git
alone, for every stream that lands after the switch.

**Direction.** Default merge message `Merge branch 'worktree-<name>'` is
kept — it names the stream, and the prepare-commit-msg hook does not stamp
it (branch is `main` during land). `--no-edit` so `land` stays
non-interactive. `.husky/post-commit` skips merge commits and
`.husky/post-merge` deploys — verified by reading both before the change
(`post-commit` "skips merge commits since post-merge handles those").

**First implementation chunk.** The merge line, plus every place that
describes landing as a pure pointer move: `bin/land` header (`:2`, `:14-17`),
the merge-ready comment (`:76-78`), the refusal text (`:162-165`), the
success report (`:175`), and `bin/CLAUDE.md:58-74`. Run `bin/land --dry-run`
in this worktree to confirm preflight still reports correctly.

### Track 4 — the reader, and the convention text

**What.** `bin/commit-provenance.ts` gains query modes:
`--workstream <name>`, `--plan <name>`, `--issue <name>`; each prints
`git log --oneline` of matching commits (`--grep='^Key: value$'`
`--extended-regexp`), across all refs by default (`--all`) so unlanded
stream work is visible, with `--main` to restrict to `main`. `pnpm
commit-provenance` script alias at the root. Then:

- Root `CLAUDE.md`: one paragraph — the three keys, `Issue:` is optional and
  a bare name, hooks fill the other two, `pnpm commit-provenance --issue
  <name>` to find commits.
- `.claude/skills/bbx-issue-actions/SKILL.md:133-141` (`fixed` disposition):
  put `pnpm commit-provenance --issue <name>` first; keep `git log -S` as
  the fallback for history before this convention.
- `bin/CLAUDE.md`: mechanism paragraph (hook files, script, `--no-ff`).

**Why.** A trailer nobody queries is ceremony. The query is the smallest
consumer; the skill edit is the observed failure the trailers exist for.

**First implementation chunk.** Query modes + a doctest that creates a
throwaway repo, commits with trailers, and checks each mode's output. Docs
edits in the same chunk.

## Could this be simpler?

Simplest version: **no hooks — only `bin/land --no-ff`** (Track 3). Landings
become visible; `git log --first-parent main` lists them; the merge message
names the branch. Zero per-commit ceremony, zero new script.

What the fuller plan buys:
- Per-commit stream attribution survives `git blame` → commit → trailer
  lookups, which `--first-parent` cannot do without walking topology
  (`git log --ancestry-path`). The clerical session's question was "which
  stream produced *this line*"; the simple version answers only "which
  landing".
- `Issue:` — the "fix landed inside a larger change in a stream that never
  closed the item" case has no answer without a commit→issue link. Nothing
  derivable supplies it.
- `Plan:` is free once the hook exists (same file scan, no extra concept).

Dropped toward simple: no `/finish` cross-check, no workstreams-app panel,
no retrofit, no `Plan:` when ambiguous, no required trailers. Traces to #9
derive-over-declare and the boxholder's "not manual" steer.

## Subplans

None. Each track's decisions are inline.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A checkout without the hook file (history before this plan, or `HUSKY=0`) | no | commits proceed without trailers — today's state | silent by design |
| Branch is not `worktree-*` (main, detached HEAD during rebase) | unit | no-op | silent (correct) |
| Zero or several plans claim the stream | unit | `Plan:` omitted | silent at commit time; accepted — `--workstream` still finds the commits, and a stream with several active plans is itself the anomaly. `--check` could warn once; not in v1 |
| Plan frontmatter unparseable | unit | one stderr line, exit 0 | clear, non-blocking |
| `git interpret-trailers` missing/old | no | script errors → stderr, exit 0 | clear |
| `Issue:` names no file | unit | block with suggestions | clear |
| `Issue:` names a file that is later renamed (slug change) | no | none — link dangles | silent |
| Agent writes `Issue:` with a path or `.md` suffix | unit | block; message shows the bare form | clear |
| `--no-ff` land on a branch with one commit | manual (`--dry-run` + a real land) | merge commit still created | clear |
| `post-merge` deploy after a `--no-ff` merge | existing hook | `.husky/post-merge` | clear |
| Query on history before the convention | doctest (empty result) | prints nothing; skill falls back to `git log -S` | clear (skill text says so) |

> **Accepted risk:** an issue renamed after commits reference it. Issue
> basenames are date-plus-slug and are not renamed in practice (`git mv` into
> `closed/` keeps the name). If it happens, `--issue <old-name>` still finds
> the commits; only the file link is lost. Not worth a rename hook.

No critical gap: every silent row is either today's behavior or a correct
no-op.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — agent writes `Issue:` with the path form.
  ADDRESSED: Track 2 blocks and shows the bare form.
- **Stale ref** — issue closed/moved after the commit. ADDRESSED: bare name
  survives moves; validator searches `closed/` too.
- **Two agents touching the same card** — two agents, one worktree, both
  committing: each commit gets the same `Workstream:`; path-scoped commits
  (`bin/CLAUDE.md`) already govern. ADDRESSED by existing convention.
- **Hand-edit drift** — a human commits from a worktree with `git commit`
  in an editor: hook fills trailers into the template; `--if-exists replace`
  dedupes if they also type one. ADDRESSED.
- **Fabricated free-form value** — agent invents an `Issue:` that sounds
  right. ADDRESSED: existence check. Tagging an existing but *wrong* issue is
  not detectable; accepted (optional trailer, no regression from today).
- **Validation error UX** — block message names the bad value, the bare
  form, nearest matches. ADDRESSED in Track 2.
- **Partial migration / transition state** — history before the switch has
  no trailers; `--first-parent` shows no landings before Track 3. ADDRESSED:
  skill keeps the `git log -S` fallback; no retrofit (NOT in scope).

## NOT in scope

- **`/finish` cross-checking `Issue:` trailers against plan `issues:` or
  closures** — boxholder: "I don't feel a need to police finish policy in the
  trailers."
- **Retrofit via `git notes`** — no reader asks about the past yet; the 58
  merge commits already give coarse history.
- **Workstreams app commit panel** — it shows no commits today
  (`workstreams-app/src/server/workstream-changes.ts` is diff-shaped); a
  panel is new UI, deferred until the CLI query is in use.
- **More override-style trailers** — filed separately:
  `issues/exploration/2026-08-24-more-tripwires-with-auditable-overrides.md`.
- **Required `Issue:`** — decided optional; hand-maintained association rots
  (issue `workstream:` is ~72% `unknown`/`unattached`).
- **Deriving issue `workstream:` frontmatter from commits** — commits are now
  the raw record for stream/plan, but the frontmatter keeps meaning
  "ownership/intent"; reconciling the two is a later decision.
- **Stamping `Plan:` when several plans claim a stream** — omitted rather
  than guessed.
- **`Issue:` for private issues** — never validated or stamped; see Track 2.

## Open design questions

- Should `--check` also warn (not block) when a worktree launched with
  `--issue X` commits without any `Issue:` trailer? Lean: no — optional means
  optional; a nag becomes noise on every commit.
- Should `Plan:` also be derived on `main` commits (a plan with
  `workstream: unattached` executed from main)? Lean: no — `main` commits
  are small tasks by convention (`feedback_main_session_no_worktrees`).

## Knowledge audits

This is dev-repo guidance (root `CLAUDE.md`, skills), invisible to box
agents; knowledge audits test box agents only (`knowledge-audit` skill:
"Dev-repo guidance like this repo's CLAUDE.md … is invisible to box agents;
audits can't test it"). Skipped with that rationale. The dev-side check is
the doctest in Track 4 and the fact that the two automatic trailers need no
recall at all.

## Implementation order

1. Track 1 — script `--prepare`, tests, `.husky/prepare-commit-msg`. Verify
   by committing in this worktree and reading the trailers back.
2. Track 2 — `--check`, tests, `.husky/commit-msg` second line.
3. Track 3 — `bin/land --no-ff --no-edit`, header comment, `--dry-run`.
4. Track 4 — query modes, doctest, root `CLAUDE.md`, `bin/CLAUDE.md`,
   `bbx-issue-actions` skill edit.
5. Cross-model review of the whole diff (the `CLAUDE.md` paragraph binds
   every future agent). Address findings. Then close the two issues via
   `/finish`.

## Rollout shape

- Tests first: unit tests for `commit-provenance.ts` (branch parse, plan
  resolution, trailer parse, issue lookup) written before the hook files;
  the Track 4 doctest exercises the real `git` end-to-end in a temp repo.
- Ships as one unit via `/finish` → `bin/land` (which, after Track 3, lands
  it with the first `--no-ff` merge — its own smoke test).
- No data migration: existing commits are untouched; existing issue/plan
  files are unchanged.
- Activation: `core.hooksPath` is the relative `.husky/_` (verified:
  `git config --get core.hooksPath` → `.husky/_`), resolved against each
  worktree's own checkout, and `.husky/_/prepare-commit-msg` already exists
  as a husky shim that runs `.husky/prepare-commit-msg` if present. Adding
  the file activates the hook in every checkout as soon as the commit is in
  that checkout — no `pnpm install` step.
