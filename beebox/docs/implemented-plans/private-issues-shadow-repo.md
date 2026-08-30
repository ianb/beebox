---
title: "Private issues: a shadow repo mounted at `<checkout>/private-issues/`"
status: implemented
workstream: unknown
issues: []
---
# Private issues: a shadow repo mounted at `<checkout>/private-issues/`

## Problem

The boxholder has follow-up work (migrating his own boxes, personal/operational
tasks) to track as issues, but it cannot go in the public, source-available
repo. He wants issues that are git-tracked (history + the worktree workflow)
but private. Gitignoring a dir fails because gitignored content doesn't travel
to worktrees. The answer is a separate private repo whose checkouts shadow
beebox's, one-for-one.

## Locked decisions (settled with the boxholder)

1. A standalone repo `callback-private-issues/`, a **peer directory of the
   main checkout** (see "Location derivation" below; `~/src/…` in examples is
   illustrative, never hardcoded), with its own private remote, category
   layout mirroring `issues/` (bugs/, features/, code-quality/,
   docs-and-chores/, decisions/, exploration/, watch/, closed/<category>/).
2. Its checkouts mirror beebox's topology at the SAME branch names,
   including `main`:
   - beebox main checkout: `private-issues/` is a **symlink** to
     `~/src/callback-private-issues/` (the private repo's primary `main`
     working tree — `main` can only be checked out once, and the primary tree
     holds it).
   - each beebox worktree: `private-issues/` is a **symlink** to a git
     worktree of the private repo at `~/src/private-issues-worktrees/<name>/`,
     on branch `worktree-<name>` (identical to the beebox branch name).
     **This amends the original "real worktree inside the checkout" idea**
     (Codex review, adopted): the private worktree lives OUTSIDE the
     disposable public worktree — same pattern as `~/src/box-worktrees/` —
     so deleting the public worktree by ANY path (Claude Code removal, sweep,
     a raw `rm -rf`) removes only a symlink and can never destroy private
     work. Every checkout's mount is now uniformly a symlink. The mount path
     `<checkout>/private-issues/` is unchanged.
3. The mount is always `<checkout>/private-issues/`, gitignored in beebox
   (a nested repo at an ignored path: beebox never tracks it, `git add
   -A` can't stage it — the leak guard).
4. `/finish` couples the private merge with the public one by default.
5. The dev issues browser (`/workstreams/issues/`) lists private issues alongside
   public ones.

## Location derivation (no hardcoded `~/src/`)

Not everyone keeps checkouts under `~/src/`. Every script derives locations
from where the monorepo actually lives, never from `$HOME`:

- **Main checkout root** — from any checkout (main or worktree):
  `MAIN=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")`
  (the common git dir lives in the main checkout; worktrees point at it).
- **Private repo** — `PRIV=$(dirname "$MAIN")/callback-private-issues`.
- **Private worktrees** — `$(dirname "$MAIN")/private-issues-worktrees/<name>/`.

One place owns the derivation — built as the `bin/private-issues` CLI
(subcommands init/mount/status/remove-if-safe/report-orphans/prune), which
the hooks and `bin/workstreams` shell out to rather than sourcing a lib. Two
hardening rules (round-2 finding 6): every command takes an **explicit
checkout-path argument** — each caller passes the anchor it already has
(`$worktree_path`, `$REPO_DIR`, the sweep's `$d`) — never bare cwd, which is
wrong for `bin/workstreams` run from elsewhere and for WorktreeRemove after
deletion. And the private repo must pass an **identity check** before any
script touches it: `bin/private-issues init` writes `git config
callback.privateIssues true` plus a `.callback-private-issues` marker file
into the repo it creates, and every consumer verifies the marker before
mutating — so a same-named unrelated directory is refused (and init refuses
to adopt it) instead of silently used. All `~/src/…` paths in the sections
below are examples of the derived values.
(The existing hooks hardcode `$HOME/src/beebox-worktrees` etc. for the
PUBLIC side — that's pre-existing and out of scope here; the private
mechanism starts portable.)

## Per-developer, not boxholder-only

This is a **shared mechanism, personal instance** — the same shape as
`.commit-blocklist` (tracked guard script, gitignored personal list). Every
developer of this source-available repo can opt in by creating their OWN
private repo at the derived peer path (`<parent-of-main-checkout>/
callback-private-issues/`); the hooks soft-detect it and do nothing when it's
absent. Nothing about the mechanism is specific to the boxholder:

- The path is derived from the checkout location (see "Location derivation"),
  so it works identically for anyone, wherever they keep their checkout, and
  the tracked hooks never embed a personal path.
- Bootstrap is documented for everyone (issues/CLAUDE.md +
  `bin/private-issues init <checkout>`, which does the `git init` + category
  dirs + README + main-checkout symlink, so opt-in is one command). Each developer
  wires their own remote (or none — a local-only private repo is fine).
- Absence is the default and is silent-by-design: one quiet log line in
  worktree-create, no warnings anywhere else.

## What goes in the private repo (routing rule + agent check-in)

`issues/CLAUDE.md` gains a routing rule, since the public repo is
source-available and its issues are world-readable:

- **Private repo:** anything about a person's own boxes or their content,
  personal/operational tasks, server/infrastructure specifics, names or
  identifiers of non-public people/domains, credentials-adjacent details —
  and any issue whose *examples* need such details to be useful.
- **Public `issues/`:** everything about the code itself, reproducible with
  public context.
- **When unsure, agents must ask the developer** before filing publicly —
  "does this contain non-public information?" is a human call. An agent that
  can sanitize an issue into a fully public form may file it publicly, but
  when the sanitized version loses the substance (the recent
  "sanitized, no box-content specifics" commits are the tell), the unsanitized
  version belongs in the private repo — possibly BOTH: a sanitized public
  item cross-linking nothing, and a private item holding the specifics
  (private→public links are allowed, so the private item carries the link).

## Key load-bearing fact (narrows the data-loss edge)

A `git worktree` shares its repo's object store and refs: **commits made on
`worktree-<name>` inside `<wt>/private-issues/` live in
`~/src/callback-private-issues/.git` immediately.** Deleting the worktree
directory (even `rm -rf`) cannot destroy committed private work — it leaves an
orphaned-but-intact branch plus a prunable worktree registration. The only
truly destructible state is **uncommitted changes** in the private worktree.

The symlink topology (locked decision 2, as amended) makes this structural:
no public-worktree removal path — Claude Code's own removal, session-end,
sweep, or a raw `rm -rf` — touches the private worktree directory at
`~/src/private-issues-worktrees/<name>/`; it deletes a symlink. Cleanup is
therefore **remove-if-safe, orphan-if-not**:

- A private worktree that is merged into private `main` AND completely clean
  (NO deletion-only exemption here — an uncommitted deletion of a private
  issue is intentional work, not the public tree's phantom-deletion artifact;
  ANY `status --porcelain` output counts as dirty) is removed with
  `git worktree remove` + `branch -d` as part of cleanup.
- Anything else is **left in place as an orphan** — an intact directory plus
  its branch — never force-removed, never auto-committed. `bin/workstreams
  sweep` (and `status`) durably REPORT orphaned private worktrees and
  unmerged `worktree-*` private branches every run, so an orphan is
  discovered even when a hook's own log line was lost (hook logging is
  best-effort). Recovery: re-create a worktree with the same name (re-attach)
  or merge the branch from the primary tree.
- A mount that exists but doesn't validate (dangling symlink, damaged
  `.git`, a plain directory where a symlink should be) **fails closed**: the
  cleanup logs it and skips all private handling — since removal only ever
  targets a validated private worktree, a sick mount can orphan state but
  never destroy it.

## Changes, surface by surface

### A. Bootstrap — `bin/private-issues init` (any developer; local only)

A tracked CLI subcommand so opt-in is one command, run here once for the
boxholder's instance:

- `git init -b main "$PRIV"` (the derived peer path); category dirs with
  `.gitkeep`; `README.md` (loud "separate repo" note, one-way link rule,
  recovery notes); initial commit. Idempotent (existing repo → no-op).
- Symlink in the main checkout: `ln -s ~/src/callback-private-issues
  <main-checkout>/private-issues`.
- Never creates a remote or touches credentials — each developer wires their
  own remote (or none); finish's push leg is built now but end-to-end tested
  only once a remote exists.
- This session's own worktree (`private-issues` — awkward name collision with
  the mount, but harmless) gets its mount by running the same logic by hand to
  test it.

### B. `.gitignore` (beebox repo root)

Add `/private-issues` — anchored, **no trailing slash** (round-2 Codex
critical: a trailing-slash pattern matches directories only, and the mount is
now a symlink in every checkout; `/private-issues/` would leave the symlink
UNIGNORED and stageable by `git add -A`, defeating the leak guard). Verify
with an actual symlink: `git check-ignore`, `git status --porcelain`, and
`git add -A --dry-run` must all treat it as ignored — this becomes a test in
the end-to-end matrix, not a one-off manual check. Expectation:
`path-leak-check` and `doc-check` scan tracked files only, so the ignored
tree is invisible to them — verify that against both scripts during
implementation rather than trusting this line (Codex finding 10 flagged it
as unverified).

### C. `worktree-create.sh` — mount on create

A new step, factored as a small function so BOTH the fresh-create path and the
resume early-exit path run it (today resume exits before later steps; the
mount must self-heal on resume):

- If `~/src/callback-private-issues` doesn't exist → log one warning, skip
  (soft dependency; nothing else changes).
- Model the states independently (round-2 finding 2 — the common recovery
  case is a preserved orphan: target dir still registered with the branch
  checked out, where a blind `worktree add` fails on both counts):
  1. Mount coherent (symlink → registered private worktree on the right
     branch) → done.
  2. Target dir exists and is a registered private worktree on
     `worktree-<name>` → recreate only the symlink, and **log loudly** —
     "re-attaching preserved private worktree, N commits unmerged" — so
     inherited work is a visible, deliberate resume (round-1 finding 7;
     same-name = same task is the established public-side convention).
     This also heals a crash between `worktree add` and `ln -s`.
  3. No registration, branch `worktree-<name>` exists → `worktree add`
     attaching the existing branch (no `-b`), same loud notice, then symlink.
  4. Nothing exists → `worktree add -b worktree-<name> … main`, then symlink.
  5. Anything else (target dir exists but isn't a registered private
     worktree; branch checked out at some other path) → log and SKIP the
     mount entirely (fail closed; the session runs without private issues
     rather than guessing).

Runs right after step 1 (worktree add), before the slow box-clone/installs —
it's milliseconds, and an ERR-trap abort later still leaves a coherent mount.

### D0. One lock for every private-repo mutation

Round-2 finding 4: `session-end.sh` fires auto-sweep in the background and
then continues its own cleanup, so two processes can concurrently
validate/remove/prune the same private repo (and auto-sweep.sh already
documents that concurrent `worktree prune` corrupts things). The shared
location-derivation helper therefore also provides a **mutation lock** — a
`mkdir`-based lock dir inside the private repo's `.git` with a stale-age
takeover — and EVERY private mutation (worktree add/remove, branch delete,
prune, the finish merges) runs under it, **re-running its safety checks
after acquiring** (check-then-act must be inside the lock). Read-only
reporting doesn't take the lock.

### D. `session-end.sh` — remove-if-safe

Today: cleans up only when beebox `ahead==0 && dirty==0`. Added private
handling, per the topology section:

- Validate the mount: `<wt>/private-issues` is a symlink to
  `~/src/private-issues-worktrees/<name>` and that directory is a registered
  worktree of `~/src/callback-private-issues`. A present-but-sick mount →
  log `decision=private-mount-invalid`, skip ALL private handling (fail
  closed — no removal of anything private), and continue the public cleanup
  (which only deletes the symlink).
- If valid: `p_ahead = git -C <privwt> rev-list --count main..HEAD`;
  `p_dirty` = ANY `status --porcelain` output (strict — no deletion-only
  exemption; deleting a private issue is intentional work).
- Merged + clean → `git -C ~/src/callback-private-issues worktree remove
  <privwt>` and `branch -d worktree-<name>` (`-d` not `-D`: if it refuses,
  our merged check was wrong — log and leave the branch). If `worktree
  remove` itself refuses, do NOT force and do NOT escalate: log and leave
  the private worktree as an orphan (Codex finding 3 — a refusal means the
  state changed under us; never convert a safety refusal into destruction).
- Unmerged or dirty → leave the private worktree in place as an orphan and
  log `decision=private-orphaned branch=... ahead=N dirty=M`. Public cleanup
  proceeds either way — with the symlink topology it cannot destroy private
  work, so the public and private decisions are independent.

### E. `bin/workstreams sweep` — same rule, plus durable orphan reporting

(The orphan scanner is a function in `bin/workstreams` invoked by `sweep` —
NOT by `status`, which is a thin router query that exits early when the
router is down; wiring the scanner there would change its contract.)

- The sweep loop applies exactly D's logic per worktree (validate → remove
  only merged-and-strictly-clean → otherwise leave + report).
- **Durable discovery** (Codex finding 8 — hook logs are best-effort): every
  sweep run also reports, unconditionally: (a) directories under
  `~/src/private-issues-worktrees/` with no corresponding public worktree,
  with their ahead/dirty counts; (b) `worktree-*` branches in the private
  repo not merged into private `main` and not attached to any live worktree.
  These lines print in sweep output AND the lifecycle log, so an orphan is
  re-announced on every session start until resolved. Removal of a clean
  orphan happens in sweep; an unmerged orphan is only ever reported, with
  the recovery command (`git -C ~/src/callback-private-issues merge
  worktree-<name>`, or recreate the worktree by name to resume).
- `git -C ~/src/callback-private-issues worktree prune` at the end of a
  sweep clears registrations whose directories were removed by hand.

### F. `worktree-remove.sh` — symlink-only cleanup

With the topology change this hook needs no rescue tier (Codex finding 2 —
its ordering guarantees are unverified and `set -e` makes an auto-commit
fragile; all of that is now moot). Claude Code's removal deletes the public
worktree (symlink included). The hook applies the same remove-if-safe logic
as D on the private worktree: merged + strictly clean → remove worktree +
`branch -d`; anything else → leave the orphan in place and log. No `--force`,
no auto-commits, nothing destructive on any path.

### G. finish agent (`.claude/agents/finish.md`) + `/finish` skill

A parallel private leg. Activation uses the SAME fail-closed mount
validation as D (round-2 finding 3): **absent** mount (no symlink, private
repo not adopted) → skip the leg silently; **present-but-invalid** mount
(dangling symlink, wrong target, unregistered dir, wrong branch, or a repo
that fails the identity check) → `RESULT: BLOCKED` naming what's wrong —
never treat a broken mount as opted-out, and never commit into an
unvalidated directory. When valid:

- **Step 2 (stragglers):** also commit private-tree stragglers (issue closes
  there are this session's work), committed FROM INSIDE `private-issues/`.
- **Step 3 (pull main):** also `git -C <wt>/private-issues merge main`
  (private main into the private branch). Conflicts here are markdown-only;
  same resolve-or-BLOCKED rule.
- **Verification:** none for the private tree — it is issues-only markdown
  with no tooling; there is nothing to run. (doc-check does not cover it;
  the one-way link rule in section I is the guard that matters.)
- **Step 8 (merge gate):** the finalization gate additionally requires: the
  private worktree strictly clean; the private PRIMARY checkout
  (`~/src/callback-private-issues`) on `main` and clean (Codex finding 6 —
  the merge runs there; also add the same on-`main` check for the public
  main checkout, which the current gate text claims but doesn't verify).
  Merge order: **public first, then private** —
  the existing public `--ff-only`, then `git -C ~/src/callback-private-issues
  merge --ff-only worktree-<name>`. Rationale (Codex finding 5): the merges
  cannot be atomic across two repos, so pick the failure mode that heals
  itself — a private merge that fails after public landed leaves the private
  branch intact and mergeable at any later moment (the sweep reports it until
  it lands), whereas private-first can leave private `main` describing public
  work that never merged. The BLOCKED contract stays exact for the public
  repo: blocked before step 8 ⇒ nothing merged anywhere.
- **Partial landing is part of the return contract, not prose** (round-2
  finding 5): the finish agent's contract gains a mandatory `PRIVATE:` line
  in every report when the mount is active, with exactly four values —
  `merged <hash>` | `no changes` | `MERGE FAILED — branch worktree-<name>
  preserved; run: git -C <priv> merge worktree-<name>` | `merged <hash>,
  PUSH FAILED — run: git -C <priv> push <remote> main`. The overall line
  stays `RESULT: MERGED` when public landed (public main is the authority);
  a failed private leg never blocks or reverts it, and cleanup safety is
  unaffected (the unmerged private worktree is orphan-preserved by D–F).
- **Push:** to the repo's actual remote — `R=$(git -C <priv> remote | head
  -1)` — never a hardcoded `origin`; no remote → `PRIVATE: … not pushed (no
  remote)` (the expected state until the developer wires one).
- **Step 7b (issue closes):** note that PRIVATE issue closes use the same
  `git mv` convention inside `private-issues/`, but `doc-check --fix` does
  not apply there (no tooling in the private repo; links are healed by hand).
- **Report:** the RESULT block names both merges (public hash + private hash
  or "no private changes").

The `/finish` skill's dispatch prompt gains one line telling the subagent to
handle the private leg if the mount exists.

### H. Issues browser (`bin/router-issues.ts`)

Precedent: the scoped gitignored-path include for `scratch/` in
`router-docs.ts` (41bba01a).

- **Record model, not a path prefix** (round-2 finding 7 — category/closed
  parsing keys off the first path segment, so a bare `private/` prefix would
  mis-classify every private record): `IssueRecord` gains
  `visibility: "public" | "private"`, keeping `relPath` **issue-relative**
  (`bugs/2026-08-01-foo.md`) for both sources; only URLs carry the
  `private/` prefix (`/workstreams/issues/private/bugs/…`), added/stripped at
  the routing layer. Enumeration and overlay stay restricted to recognized
  category dirs (which also keeps the private README and other root files
  out); content/diff roots are parameterized per source instead of the
  hardcoded `issues/` prefix.
- **Index:** `listIssues` runs a second pass over `<mainRoot>/private-issues/`
  (the symlink → private primary tree; absent dir → zero records, no error).
  Private records render with a distinct `private` chip and get a
  `visibility: public|private` filter facet.
- **Overlay:** `collectOverlay` runs a second per-worktree pass with cwd
  `<wtRoot>/private-issues` — same three commands but WITHOUT the `issues/`
  pathspecs (Codex finding 9: the private repo's categories sit at its root,
  so the existing `-- issues/` scoping would match nothing; scope to
  `*.md`/`**/*.md` instead), paths already repo-relative, keys mapped into
  the `private/` namespace. Worktrees without the mount skip silently.
- **Detail page:** a `private/`-prefixed relPath resolves against the private
  root (main's symlink for content, each worktree's mount for diffs) with the
  same traversal guard.
- **Security posture:** unchanged — every TCP request to `/dev/` already
  requires an owner session (fail-closed router); the UDS is same-user-only.
  Private issues are exactly as exposed as the rest of /dev/, i.e. to the
  boxholder only.
- **Tests:** extend `router-issues.test.ts` pure-function coverage (namespace
  mapping, private overlay merge, filter facet).
- The live router only picks this up after main-merge + `pnpm dev` restart —
  boxholder's call, per standing rule.

### I. One-way link rule (public must never link private)

- **Documented** in `issues/CLAUDE.md` (new section) and the private README:
  private→public links are fine; public→private links are forbidden — a
  dangling ref for anyone without the private repo.
- **Enforced:** `doc-check` would PASS a tracked `private-issues/…` link on
  an opted-in machine (the symlink resolves!) and break for everyone else —
  silent rot. Add an explicit doc-check rule that is **lexical, before any
  filesystem resolution** (Codex finding 10): a tracked file is a hard error
  if any markdown link target (inline or reference-style), after posix
  normalization of the relative path, contains a `private-issues/` path
  segment — covering `private-issues/…`, `../private-issues/…`,
  root-relative forms, and `/workstreams/issues/private/…` browser URLs. With tests
  (both directions: each forbidden form errors; private-issues *mentioned in
  prose* stays legal).

### J. Docs

- `issues/CLAUDE.md`: new "Private issues" section — separate repo,
  per-developer opt-in (`bin/private-issues init`), mount topology,
  commit-from-inside rule ("an agent that edits a private issue and runs
  `git add -A` in beebox sees nothing staged — that is the leak guard
  working"), one-way links, orphan recovery (re-create by name, or merge the
  preserved branch), and the **routing rule +
  ask-the-developer check** from the section above (what belongs private,
  when to ask, the sanitized-public + detailed-private split pattern).
- `bin/CLAUDE.md`: lifecycle additions (create-mount state machine,
  remove-if-safe/orphan-if-not in session-end/sweep/worktree-remove, the
  private mutation lock, sweep's orphan report).
- Private repo `README.md`: everything above from the private side.
- Root `CLAUDE.md`: one line in the monorepo-layout section.

## Sharp edges audited

1. **Silent drop of unmerged private work** — structurally closed by the
   symlink topology (no removal path touches the private directory) +
   remove-if-safe (strict dirty, no force, no escalation) + the object-store
   fact; residual risk is an *orphan the developer must notice*, covered by
   the unconditional per-sweep orphan report (E), not just best-effort hook
   logs.
2. **Public→private links** — documented + doc-check hard error (I).
3. **Separate-repo commits** — loud docs (J); the gitignore makes accidental
   staging structurally impossible.
4. **Hook timeout** — the mount step and remove-if-safe checks are
   milliseconds; no slow work added to any hook.
5. **Sweep/session-end run MAIN's copies** of these scripts — the new
   private-aware logic only takes effect after this branch merges to main.
   With the symlink topology this is benign even in the interim: main's
   current sweep/session-end would delete only the symlink, and the current
   sweep skips this worktree while its session is active anyway. Merge as
   one unit regardless.

## Test plan

- Unit: router-issues pure functions (namespacing, overlay merge, facets).
- Scripted end-to-end on a throwaway name (no Claude session needed): run
  `worktree-create.sh` with faked stdin JSON → verify private worktree +
  symlink + branch; dirty the private tree (including a deletion-only case
  and an uncommitted-deletion case) → run `session-end.sh` with faked
  stdin → verify the public side cleans, the private worktree survives as
  an orphan, and the log lines appear; merge + clean → verify full cleanup
  including private worktree + branch; sick-mount case (dangling symlink,
  plain dir) → verify fail-closed skip; `worktree-remove.sh` same matrix.
  `bin/workstreams sweep --dry-run` verification of removal, orphan-report,
  and prune behavior. Note: faked-stdin runs exercise our scripts, not
  Claude Code's own removal ordering — with the symlink topology that
  ordering no longer matters for safety (nothing Claude Code deletes holds
  private state), which is the point of the topology change.
- doc-check one-way-link rule: unit cases for every forbidden link form and
  the legal prose-mention/private→public directions.
- finish's private leg: exercised on THIS worktree when we finish it (its own
  private issues will exist by then); push leg untestable until the remote
  exists — reported, not silently skipped.
