---
title: "Commit performance: make box commits fast"
status: active
workstream: commit-performance
issues:
  - ../../../issues/bugs/2026-08-18-box-precommit-hook-costs-seconds-per-commit.md
---
# Commit performance: make box commits fast

**Issues addressed:** [box pre-commit costs seconds per commit](../../../issues/bugs/2026-08-18-box-precommit-hook-costs-seconds-per-commit.md)

**Goal:** minimize total `git commit` time on a box. Commit duration is now
also lock-hold duration (`withBoxGitLock` serializes every writer on a box),
so this is a throughput problem, not only an impatience problem.

## Measured attribution (2026-08-19, test1 clone, 1,815 files, M-series Mac)

| Component | Time |
|---|---|
| `git commit --no-verify` (git's own work + post-commit hook) | ~0.08s |
| `git annex pre-commit .` | ~0.11s |
| `cb validate --staged` (1 staged md) | ~0.78s |
| `cb validate --links` (box-wide) | ~0.70s |
| `cb attachments check-unlisted` (box-wide walk) | ~0.78s |
| **Full `git commit`, end to end** | **~2.3s** |

The three `cb` invocations are ~95% of commit time on a small box. Each is
dominated by startup (`cb --version` ≈ 0.66s warm), not by the check itself
(~0.05–0.15s each). On a box ~10× larger, the two box-wide scans add ~2.4s of
real scanning work (measured 2026-08-18), on top of the same three boots.

Startup floor composition (warm V8 compile cache):

- bare `node -e 'exit'`: 0.03s
- full `dist/cli.mjs --version`, no source maps: ~0.58s
- `--enable-source-maps` adds ~0.12s (despite the build comment's claim that
  the external map loads lazily)
- A probe bundle containing only the validate + attachments graph boots in
  ~0.41s — and its CPU profile still shows `@anthropic-ai/claude-agent-sdk`,
  `sharp`, and `rrule` loading, because `cli/commands/attachments.ts` imports
  the `core/commands/index.ts` barrel (→ triage → agent → SDK) and the schema
  registry pulls `rrule`. The full CLI graph additionally loads `typescript`
  (via `view-typecheck.ts`) eagerly, for every invocation including
  `--version`.

## Phase 1 — one boot, incremental scans (implemented here)

### 1a. Collapse three hook invocations into one: `cb validate --pre-commit`

New mode on `cb validate` that does, in one process:

1. **Staged validation** (blocking) — exactly what `--staged` does today:
   staged cards via `lintCardsDispatch`, staged markdown via
   `lintMarkdownFiles`. Skipped silently when nothing relevant is staged.
2. **Link scan** (warn-only, stderr, never blocks) — the box-wide
   `boxWideLinkWarnings` pass, but **gated: it runs only when the staged diff
   deletes or renames a path** (`--diff-filter=DR`). Only a delete/rename can
   make a link in an *unstaged referrer* newly dangle — an added or modified
   file can break only its own links, which step 1 checks. This preserves
   exactly the property the box-wide scan exists for (the hook comment's "a
   move can break links in files that aren't staged") while skipping the scan
   on the overwhelmingly common add/modify commit. Deliberate side effect:
   pre-existing dangling links stop being re-warned on every unrelated
   commit; `cb health` / `cb validate --links` still surface them on demand.
3. **Unlisted-binary guard** (blocking) — reframed from a box-wide
   filesystem walk to an **index-based check**: staged files (ACMR) inside
   attach scopes whose extension is not in `ASSET_EXTENSIONS` and whose
   *staged blob* exceeds 1 MB. This is strictly better targeted than the
   walk: bytes enter history only via staged blobs, so the check fires at
   exactly the commit that would embed them, and pre-existing on-disk debris
   no longer blocks unrelated commits (it remains visible via `cb doctor
   annex` / `attachments verify`, which keep the box-wide walk). Checking the
   staged blob size (not the working file) also naturally passes annex
   pointer files and catches an allowlisted extension staged raw through an
   annex misconfiguration — a case the extension-allowlist walk let through.

Exit non-zero iff step 1 or step 3 found errors. The hook template in
`install-validation-hooks.ts` becomes a single `"$CB" validate --pre-commit`
call (annex pre-commit, the `cd`, and the cb-not-found fallback are
unchanged). Boxes pick the new hook up on their next `cb init`.

Expected result: small-box commit ~2.3s → ~1.0s (annex 0.11 + one boot ~0.7 +
staged work + git 0.08). Large boxes stop paying the tree-sized scans on
add/modify commits entirely, so the cost stops scaling with box growth.

### 1b. Trim the eager import graph (helps every `cb` invocation)

Make the heavy externals lazy (dynamic import at use site):

- `typescript` in `cli/commands/view-typecheck.ts`
- `@anthropic-ai/claude-agent-sdk` in `core/agent/stream.ts` and
  `services/scan-vision-claude.ts`
- `sharp` in `core/commands/scan-import-helpers.ts` and
  `core/commands/document-extract.ts`

esbuild's single-file bundle keeps dynamically-imported externals as real
runtime `import()`s, so these stop loading for commands that never reach
them. Measured target: startup floor ~0.65s → ~0.4s.

### Measured after Phase 1 (2026-08-19, same box and machine)

| | before | after |
|---|---|---|
| `cb --version` (warm) | 0.52s | 0.41s |
| `git commit`, end to end (1 staged md) | ~2.2s | ~0.7s |

A commit whose staged diff deletes a path (so the link scan does run) measured
0.68s on the same box — the DR gate costs nothing detectable there, though it
would on a box large enough for the box-wide markdown scan to matter.

One file was left eager: `services/claude-chat.ts` calls `query()` from a
synchronous `start()`, which can't take an `await` without changing the
`ChatBackendRun` contract — a Phase 2 concern, since the chat backend is not on
the commit path.

## Phase 2 — further startup-floor work (measured, optional)

- **Lazy command registration**: `cli/index.ts` imports all ~60 command
  modules eagerly; a lazy registry (dynamic import in each command's action)
  plus esbuild code splitting would cut the evaluated graph to what the
  invoked command needs. Bigger churn (help text needs the Command objects);
  do only if 1b's numbers aren't enough.
- **`--enable-source-maps`**: costs ~0.12s per invocation despite the
  external map. Worth a targeted look (Node may stat/read the map eagerly at
  module load); not changed here since it buys real stack traces everywhere.

## Phase 3 — structural options (NOT built; for discussion)

- **Resident `cb`**: a long-lived process the hook (and everything else)
  talks to over a socket, killing the boot floor for every invocation. Same
  shape as the hub/router. Interacts with the dev-bundle reload work
  (2026-08-18): a resident process must notice a replaced bundle. Largest
  payoff, largest change — needs a real design round.
- **Fewer commits**: several paths commit per event rather than per unit of
  work (`cb feedback` commits every call; observed commit storm 2026-08-14).
  If a chat turn makes five commits, per-commit cost is the wrong lever.
- **Move the link warning fully off the commit path** (post-commit
  background, like the URL check, or a scheduled sweep). Phase 1's DR-gating
  makes this mostly moot; kept as an option if even the delete/rename case
  proves noticeable.
