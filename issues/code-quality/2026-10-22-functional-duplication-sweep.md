---
title: "A sweep for code that does the same job twice, in two passes: frontend and the rest"
workstream: dup-sweep-frontend
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
(2026-10-22). The frontend pass ran on 2026-10-23 (below); the backend pass
runs in `dup-sweep-backend`.

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
