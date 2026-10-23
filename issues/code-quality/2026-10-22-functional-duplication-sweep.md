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

The boxholder suggested it for a later batch of autonomous sessions
(2026-10-22). Both passes ran on 2026-10-23 (below).

## Frontend pass (2026-10-23)

Worktree `dup-sweep-frontend`, `beebox/src/frontend/` only. Five behavior
inventories (formatting, hooks and data, UI components, interaction, shared/
overlap), each group adjudicated against the code.

| Outcome | Groups |
|---|---|
| Merged (one commit each) | 29 |
| Filed | 9 issues and 1 note, covering about 30 groups |
| Not duplication | 12 |

Merged: popover dismiss (useDismiss), modal dialog (useModalDialog),
reduced-motion query, isRecord, errorMessage (54 inline copies), XML attribute
decode, delay, storageScopeFor, newMessageId, ui-scan entry cap, .attach owner,
image URL markers, external-URL test (isUrlRef), MetaItem, capture badge,
composer remove bubble, disclosure chevron, app-bar caret, captured-page
header, useBoxNow on useNow, sessionStorage JSON, snippet, parentDir,
skip-first-connect (onReconnect), push support, plain left click, dashboard
time-ago, secret reveal, raw file and image URLs.

Filed: [stall-recovery-polls-rotated-session-id](../bugs/2026-10-23-stall-recovery-polls-rotated-session-id.md),
[chat-composer-enter-sends-during-ime-composition](../bugs/2026-10-23-chat-composer-enter-sends-during-ime-composition.md),
[frontend-live-refresh-hooks-disagree](2026-10-23-frontend-live-refresh-hooks-disagree.md),
[frontend-time-and-duration-formatters](2026-10-23-frontend-time-and-duration-formatters.md),
[byte-size-formatters-disagree](2026-10-23-byte-size-formatters-disagree.md),
[card-display-name-helpers-disagree](2026-10-23-card-display-name-helpers-disagree.md),
[browser-storage-keys-and-reads-inconsistent](2026-10-23-browser-storage-keys-and-reads-inconsistent.md),
[frontend-visual-near-duplicates](2026-10-23-frontend-visual-near-duplicates.md),
[frontend-smaller-near-duplicates](2026-10-23-frontend-smaller-near-duplicates.md),
and a note on [browse-list-live-refresh-not-firing](../bugs/2026-07-31-browse-list-live-refresh-not-firing.md).

Not duplication: clock-style m:ss formats, arrow-key list navigation (three
different rules), global hotkeys (one each), scroll-to-bottom one-liners,
single-flight caches (different contracts), visual-viewport trackers,
latest-ref idioms, debounced persistence, current-user and box hooks (already
one each), chat-session row vs dead-session row (deliberate siblings), pin
icons (different geometry), humanize-slug variants (different inputs).

For the backend pass: `shared/` has no parent-directory helper (the frontend
now has `lib/parent-dir.ts`); `shared/human-bytes.ts` and the frontend
`lib/format-bytes.ts` disagree (filed above); `shared/card-browse-url.ts` has
no frontend callers.

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
[two card filename parsers](../closed/code-quality/2026-10-23-two-card-filename-parsers.md),
[atomic writes, JSON state loaders, strict exists](2026-10-23-hand-rolled-atomic-writes-and-state-loaders.md),
[inline path containment](../closed/code-quality/2026-10-23-path-containment-checks-are-inlined.md),
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

Follow-up, same day: three filed groups merged after the first landing.
Inline path containment (about 40 sites onto `isWithin`; fixes the `..name`
and parent-directory edge cases) and the two card filename parsers (one
grammar; a job card's type is now its schema type) are closed. The async
hand-rolled atomic writes (13 writers) moved onto `writeFileAtomic`; that
issue stays open for the sync writers, JSON state loaders, and strict
existence probes.
