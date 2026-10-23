---
title: "A sweep for code that does the same job twice, in two passes: frontend and the rest"
workstream: unattached
area: beebox
labels: [code-quality]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder idea while planning quota work, 2026-10-22
---

Agents write most of the code, often without finding a helper that already
does the job. The result is functional duplication: two implementations of one
behavior with different names and shapes. Text-level clone detection misses
most of it. Each copy drifts, and a fix lands in one copy only.

Known instances already filed:
[fold search and browse summaries onto summarize](2026-09-20-fold-search-and-browse-summaries-onto-summarize.md),
[one way to log everywhere](2026-07-04-logging-consolidation.md),
[chat session shared core](../closed/code-quality/2026-07-06-chat-session-shared-core.md).
The [what-can-we-remove sweep](2026-09-14-what-can-we-remove-sweep.md) is a
neighbor: it removes code with no purpose. This sweep merges code with one
purpose and two implementations.

## Proposed shape

Two passes, because the duplication differs:

- **Frontend** (`beebox/src/frontend/`): components and hooks that render or
  manage the same thing (lists, chips, empty states, loading and error states,
  card summaries, date formatting, fetch-and-subscribe hooks).
- **Everything else** (`beebox/src/` outside the frontend, `bin/`,
  `workstreams-app/`): path and slug helpers, git wrappers, card parsing and
  frontmatter access, retry and timeout logic, process spawning, config
  loading, connector plumbing.

Each pass: inventory by behavior (what the code does, not what it is named),
pick the canonical implementation, migrate callers, delete the rest, with
tests on the canonical one. Merges that change behavior for a caller, or where
the canonical choice is a design question, get filed instead.

Not started. The boxholder suggested it for a later batch of autonomous
sessions (2026-10-22).

## Backend pass (2026-10-23, worktree-dup-sweep-backend)

Scope: everything outside `beebox/src/frontend/`. Inventory by behavior
found about 40 candidate groups. One commit per merged group; each message
names the members and the canonical choice.

| Group | Result | Net lines removed |
|---|---|---|
| `isRecord` copies (7) | merged onto `shared/is-record.ts` | 16 |
| lenient `fileExists` (8) | merged onto `lib/file-exists.ts`, test added | 72 |
| `e instanceof Error ? e.message : String(e)` helpers (11) | merged onto `errorMessage`; named fix: no more `[object Object]` | 37 |
| errno guards in `bin/` and the workstreams app (5) | merged onto `errnoCode` | 21 |
| local `sleep`/`delay` (13) | `node:timers/promises` | 30 |
| hand-rolled lock-retry loops (7) | `withFileLock` with a new `timeoutError` option, test added | 70 |
| box-relative path (3) and "is within" (4) | `lib/box-containment.ts`, tests added; named fix: `..name` child | 24 |
| `plural(count, noun)` (8) | new `shared/plural.ts`, test added | 17 |
| tap-check regex escape (2) | merged | 3 |
| card title from file (2), husk frontmatter parse (1) | `readCardTitle`, `parseFrontmatterObject`, test added | 48 |
| XML attribute escape (2) | beside `decodeXmlAttr` in `shared/self-note.ts`, test added | -3 |
| `hashToken` (2) | merged onto `core/token-store.ts` | 3 |
| `gitCommonDir`, `gitLsFiles` in `bin/` (2 pairs) | merged | 14 |
| `pidAlive` (4), `killGroup` (1), `bootTimeMs` (1) in `bin/` | merged onto `hub/child-process-utils.ts`, test added | 72 |

Filed, because a merge changes output or needs a choice:
[quota collection twice](2026-10-23-agent-quota-collection-exists-twice.md),
[frontmatter split/parse/write](2026-10-23-frontmatter-read-and-write-have-many-implementations.md),
[two card filename parsers](2026-10-23-two-card-filename-parsers.md),
[atomic writes, JSON state loaders, strict exists](2026-10-23-hand-rolled-atomic-writes-and-state-loaders.md),
[inline path containment](2026-10-23-path-containment-checks-are-inlined.md),
[bin git, process, and argv helpers](2026-10-23-bin-scripts-reimplement-git-process-and-argv-helpers.md),
[dates and durations](2026-10-23-date-and-duration-formatting-variants.md),
[text helpers: truncate, slug, escape, coercion, sha256](2026-10-23-text-helpers-with-diverging-rules.md).

Judged not duplication, or not worth a merge: the dev router's own error,
`sleep`, `killGroup`, and `pidAlive` copies (the router keeps itself
self-contained); the courseware plugin's `isRecord` (plugins do not import
engine internals); the array-accepting `isRecord` guards in `bin/test-*`;
the strict ENOENT-only existence probes; `dev/layout/default-roots.ts`'s git
helper (kept apart from the move tool on purpose); `place-cards` `num` and
`place-mark` `asNumber` (one-line guards in unrelated modules);
`MissingBaseRefError` in `lint-changed`/`test-select`; the backoff formulas
(each a different policy); debounce and coalesce timers (different shapes);
`lockWithRetry` (returns false instead of throwing).

