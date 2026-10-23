---
title: "Backend duplication sweep: the remaining groups"
status: implemented
workstream: dup-sweep-backend
issues:
  - ../../../issues/closed/code-quality/2026-10-23-two-card-filename-parsers.md
  - ../../../issues/closed/code-quality/2026-10-23-agent-quota-collection-exists-twice.md
  - ../../../issues/closed/code-quality/2026-10-23-bin-scripts-reimplement-git-process-and-argv-helpers.md
---
# Backend duplication sweep: the remaining groups

**Outcome (2026-10-23):** all ten tracks are implemented. Three issues are
closed. Four stay open for parts outside this plan's tracks:
[frontmatter](../../../issues/code-quality/2026-10-23-frontmatter-read-and-write-have-many-implementations.md) (title extraction, inlined readers),
[dates](../../../issues/code-quality/2026-10-23-date-and-duration-formatting-variants.md) (box-local day, duration parsers),
[text helpers](../../../issues/code-quality/2026-10-23-text-helpers-with-diverging-rules.md) (slugs, coercion),
[atomic writes](../../../issues/code-quality/2026-10-23-hand-rolled-atomic-writes-and-state-loaders.md) (git-shim, exhibits writer, loader policies).
Deviations, each explained in its commit: track 4 adds `formatAgoMs`
instead of a `dateAfterDays` option; track 3's editors share
`editableFrontmatterDocument` and `renderFrontmatterDocument` instead of
`setFrontmatterFields`; track 3's writer step found 7 hand-built generators,
not 28 (the rest already used `renderFrontmatterBlock`); track 10 found and
fixed the cause (an `fs.watchFile` baseline race) instead of filing it.

The backend pass of the functional-duplication sweep merged the groups that had
no behavior change. This plan finishes the groups that needed a decision. The
boxholder took every lean offered on 2026-10-23 ("Work through them in order, I
think we want to do all of them").

**Issues addressed:** the seven issues in the frontmatter `issues:` list. Six
are resolved by this plan. The atomic-writes issue is partly resolved (track 7
does its strict existence probes); it stays open for `git-shim.ts`, the
exhibits writer, and the per-store loader policies, so finish must not close it. The
sweep issue (`issues/code-quality/2026-10-22-functional-duplication-sweep.md`)
gets a dated note and stays open for the frontend pass's own items. A queue
search for "frontmatter fence", "quota", "relative time", "escapeHtml",
"git wrapper" found no further duplicates beyond these.

## Design

No design section: the tracks change helper code. The visible effects are
named per track (job cards read as background in the browse listing, compact
elapsed-time text in CLI and health output, long frontmatter values stay on one
line) and were each chosen by the boxholder from a stated lean.

## Smallest fix and budget

The smallest fix is to leave the duplicates and keep the issues. The decisions
are made, so the plan does them.

| Track | Estimate (source + test lines, additions plus deletions) |
|---|---|
| 1 Card filename type | 80 |
| 2 Quota collection | 1,000 (mostly deletion of `bin/agent-quotas-*`, about 800, and a moved test) |
| 3 Frontmatter | 450 |
| 4 Elapsed-time text | 400 (including test expectation updates) |
| 5 Escape and truncate | 150 |
| 6 `bin` git helper | 350 |
| 7 Strict existence check | 120 |
| 8 Router comment | 2 |
| 9 Atomic-write residuals | 0 (accepted) |
| 10 Clock-offset flake | 60 |

Total about 2,600 changed lines. **BIG CHANGE.** About 1,200 of it is deletion
and a moved test file; the rest is spread over many small call sites. The
scope is approved; the boxholder approved the size on 2026-10-23 ("Proceed").

## Stated preferences this plan trades against

- `beebox/docs/engineering-principles.md` §8 "One way to do each thing" is the
  reason for every track.
- §4 "Resilient AND never silent": the strict existence check and the git
  helper make the failure mode explicit at each call.
- The root AGENTS.md rule for the sweep: no behavior change except named bug
  fixes. Tracks 1, 3 and 4 change visible output by the boxholder's decision;
  each commit names the change.
- Memory "stop over-engineering rare failures": track 3 does not migrate old
  cards' bytes; only new writes change.

## What already exists

- `beebox/src/shared/card-name.ts:27` `parseCardFileName` (schema type) and
  `beebox/src/shared/attach-path.ts` `cardBasename` (attach stem). Reuse.
- `beebox/src/lib/paths/core.ts:158` `parseCardName`, the older parser. Rebuild
  on the two above (track 1).
- `workstreams-app/src/server/main/quota-collect.ts`, `quota-parse.ts`,
  `quota-requests.ts`: the same algorithm as `bin/agent-quotas-*` plus GLM,
  minus four bin-only behaviors (listed in track 2). App ownership is the
  boxholder's decision (2026-10-23). `bin/` already imports from
  `workstreams-app/src/server/main/` (for example `bin/issues-context.ts`).
  Reuse after porting the four behaviors; delete the `bin` copy.
- `beebox/src/cards/frontmatter.ts:39`
  `const FRONTMATTER_BLOCK = /^---\r?\n([\S\s]*?)\r?\n---\r?\n/;` and `:107`
  `renderFrontmatterBlock` (`lineWidth: 0`). Reuse; widen the fence rule.
- `beebox/src/core/card-fields/field-edits.ts:116` `applyFieldEdits` (keeps the
  file's existing folding). Reuse as the core of the single-key editor.
- `beebox/src/frontend/src/lib/relative-time.ts` `formatAgo`, `formatDuration`
  (commit 826893cac). Move the pure parts to `beebox/src/shared/`.
- `beebox/src/lib/escape-html.ts` `escapeHtml` and
  `beebox/src/core/file-summary.ts:81` `truncateTitle`. Reuse.
- `bin/test-git.ts` `git`, `gitCommonDir`. Its imports (`test-ledger-lib`,
  `content-hash`) are too heavy for hook tools, so the new helper is a separate
  light module.
- `beebox/src/lib/file-exists.ts` `fileExists` (lenient). Add the strict twin
  beside it.

## Prior art (external)

No decision depends on an external premise except the YAML folding rule. The
`yaml` 2.9.0 package folds plain and double-quoted scalars that contain spaces
at the default width of 80, and leaves space-free scalars (URLs, ids) on one
line; `lineWidth: 0` disables folding. Verified directly against the installed
package (research note, 2026-10-23). Evaluated-only.

## Ontology

- **Card schema type**: the type a card's schema is registered under
  (`intake-job`); from `parseCardFileName`. Existing.
- **Card suffix**: the filename part after the attach stem
  (`.intake.job.card`, `.doc.card`, `.card`). New name, used only inside the
  trash rename; it is not a type.
- **Fence**: the `---` lines around frontmatter. One rule, owned by
  `cards/frontmatter.ts`.
- **Age text**: "time since X" as short text ("3m ago"). **Duration text**: a
  length of time ("1h 5m"). Two functions, `formatAgo` and `formatDuration`,
  named as in the frontend.
- **Git failure mode**: `"throw" | "null" | "empty"`, stated at every call.
No other nouns.

## Tracks / scope

### 1. Card filename type

- **What:** `parseCardName` returns `{ name: cardBasename(file), type:
  parseCardFileName(file).type }`. The trash command stops rebuilding a
  filename from the type.
- **Why:** two grammars for one filename. A job card's type is `job` in one and
  `intake-job` in the other.
- **Direction:** in `core/commands/trash/command.ts`, the collision name is
  built by a local `withCollisionStamp(basename, stamp)`: insert `_<stamp>`
  after the attach stem (`cardBasename`) and keep the rest
  (`Foo.intake.job.card` → `Foo.intake_<stamp>.job.card`, attach directory
  `Foo.intake_<stamp>.attach`, the same as today). A positional card is a
  special case, not the general rule: stamping after its stem would give
  `doc_<stamp>.card`, a different positional type, so it keeps today's form
  (`doc.card` → `doc_<stamp>.doc.card`). Browse
  prominence for job cards follows the schema (`background`), by decision.
- **Vocabulary lock-ins:** none.
- **First chunk:** the trash helper with its test, then the `parseCardName`
  rebuild with the job-card test.

### 2. Quota collection

- **What:** the workstreams app's `quota-*` modules own collection. `bin/agent-quotas.ts` becomes a thin CLI over `collectAgentQuotas`; the three
  `bin/agent-quotas-*` modules are deleted.
- **Why:** about 800 duplicated lines; a fix in one copy misses the other.
- **Direction:** port the bin-only behaviors into the app modules first: the
  "No Claude quota has been captured from an active session yet." message,
  optional `fetchedAt`, default timeout and command arguments, and the
  hermetic `codexRequest` (no cache when injected). Move
  `bin/test/agent-quotas.test.ts` cases into
  `workstreams-app/test/server/main/` against the app modules. The CLI does
  not pass `glmRequest`, so `bin/workstreams quotas --json` keeps printing
  `[claude, codex]`. `bin/agent-quotas.ts` exports a `printQuotas(collect)`
  entry so a CLI-level test pins the printed JSON shape with a fake collector.
  `quotaPace` moves with its test only if something other
  than the test uses it; otherwise it is deleted.
- **First chunk:** port the four behaviors with tests in the app.

### 3. Frontmatter

- **What:** one fence rule; one writer; one single-key editor.
- **Why:** about 18 fence finders disagree; 28 generators fold long values that
  the shared writer keeps on one line; six editors re-fence by hand.
- **Direction:**
  - Fence rule in `cards/frontmatter.ts`: accept an optional leading BOM,
    trailing spaces or tabs on both fence lines, CRLF, an empty block
    (`---\n---\n`), and a closing fence at end of file. A fence starts at
    column 0: the issue reader's `trim()` (`issue-domain.ts:65`) also accepted
    leading spaces, but no file under `issues/`, `beebox/docs/` or `.claude/`
    has an indented fence (the two indented `---` lines found are body text),
    so the rule drops that. No repo document has a BOM, CRLF, or trailing-space
    fence either; box cards are where the wider rule matters. Export
    `frontmatterFence(text): { open: number; close: number; end: number } | null`
    (character offsets) for the line-based editors that keep formatting
    (`rewrite-card-refs`, `dev/doc-check/link-repair.ts`,
    `dev/doc-graph-data/data.ts`, `bin/assign-issue-workstream.ts`,
    `bin/deferred-issues.ts`, `bin/confirm-tested.ts`, `bin/skill-lint.ts`,
    `dev/doc-check/frontmatter.ts`, `dev/doc-graph-data/document-lifecycle.ts`).
    The workstreams app's issue readers move onto the shared function too:
    `issue-domain.ts:65` (`parseFrontmatter`), `issue-domain.ts:207`
    (`frontmatterEnd`, which keeps the file's newline style for writes), and
    `issue-search-model.ts:94` (which splits frontmatter from the indexed
    body at `:119`). Generated-guidance readers (`agent-context-mirrors`,
    `docs-gen/shared`, `generate-codex-agents`) read files this repo writes
    with LF; they move onto it for one rule.
  - Writer: the 28 generators call `renderFrontmatterBlock`.
  - Editor: `setFrontmatterFields(content, edits)` in `card-fields/field-edits.ts`
    (split, `applyFieldEdits`, re-fence). It throws a typed
    `FrontmatterNotEditableError` when there is no fence, the YAML has errors,
    or the root is a non-empty non-mapping; an empty block reads as an empty
    mapping, as `webapp/trpc/routers/card.ts:215` accepts today; `applyFieldEdits` (`field-edits.ts:98`)
    checks none of these today. Domain checks stay at the call site before the
    edit: `todo/set-status.ts:86` (missing or out-of-range `todos[i]`), the
    web routers' mapping checks (`webapp/trpc/routers/card.ts:215`). The six
    editors use it; `triage/todo.ts` needs an `append` edit kind. Each caller
    keeps a test of its refusal path.
- **Vocabulary lock-ins:** `frontmatterFence`, `setFrontmatterFields`.
- **First chunk:** the fence rule and `frontmatterFence` with tests for each
  accepted form, plus `splitCardContent` on top of it.

### 4. Elapsed-time text

- **What:** `beebox/src/shared/relative-time.ts` holds `formatDuration`
  (unchanged) and `formatAgo` with the date branch as an option (`dateAfterDays`,
  default 7 for the frontend; backend callers pass `Infinity`). The frontend
  imports it; `agoOnClock` stays in the frontend.
- **Why:** about eight backend formatters with different cutoffs; the frontend
  already chose a style.
- **Direction:** move onto it: `core/schedule/health-box.ts formatDurationShort`,
  `lib/git-stale-lock.ts formatAge` (as a duration), `core/notification/health.ts formatOffset`,
  `bin/deploy-status-render.ts ago`, `bin/schedules.ts agoText` (its hour
  rounding prints "0m ago" for 20 minutes: a named bug fix),
  `cli/commands/scheduled.ts formatDuration`, `field-test/report.ts formatDuration`,
  the inline "fires in" text in `core/chat/schedules/core.ts` (keeping its
  one-minute minimum, `core.ts:190`: `formatDuration(Math.max(remaining,
  60_000))`, tested for a due-but-active check-in). Update the
  pinned expectations. Leave `bin/lib/schedules.ts formatDuration` (round-trips
  with its parser), `session-context.ts describeElapsed` (agent prose),
  `shared/deploy-page-text.ts ago` (live page), `schemas/capture-session.tsx`
  (stored card data).
- **First chunk:** move the helpers to `shared/` with their tests; frontend
  imports switch.

### 5. Escape and truncate

- **What:** HTML escapes that miss `'` use `escapeHtml`; truncation trims
  before the ellipsis everywhere.
- **Direction:** `workstreams-app/src/server/exhibits/app/pages.ts:27` and
  `beebox/src/dev/csp-report/report.ts:218` call `escapeHtml`. `truncateTitle`
  moves to `beebox/src/shared/truncate.ts` as `truncate(text, max)`; callers:
  `core/file-summary.ts`, `core/notification/log.ts clip`,
  `core/agent/invoke/render.ts truncate`, `bin/issues-output.ts truncate`, and
  the N+1-length variants (`core/scan/validate.ts`, `services/docling/core.ts`,
  `webapp/routes/api-csp-report.ts`, `webapp/routes/chat/audio-routes.ts`,
  `webapp/routes/auth/password-post.ts`). Leave `shared/favicon.ts escapeXml`
  (SVG text, no single-quoted attribute) and the dev router's copy. Slugs and
  string coercion stay as filed.

### 6. `bin` git helper

- **What:** `bin/lib/git.ts` with one primitive,
  `git(args, { cwd, onError: "throw" | "null" | "empty", quiet? })`, which
  strips one trailing newline only (porcelain output keeps leading spaces).
  `onError` has no default. Two named reads, because about 15 sites repeat
  each: `gitTopLevel(cwd?)` and `gitCommonDir(cwd?)` (trimmed, absolute).
  Callers split lines or NUL themselves. No `gitOk`/`gitLines` until repeated
  callers need them.
- **Direction:** move the named `bin` wrappers onto it (`test-git.ts git` and
  `gitCommonDir`, `smoke-harness.ts`, `deploy-status.ts`,
  `doc-lifecycle-check.ts`, `commit-provenance.ts`,
  `lib/skill-usage-catalog.ts`, `lib/codex-skill-links.ts`) and the inline
  top-level and common-dir reads. Leave async execa callers, `doctor` injected
  runners, `schedules-branch` (`{ok, stdout, stderr}` with env),
  `finish-preflight-merge`, and `beebox/src/dev` (beebox may not import
  `bin/`). Argument parsing moves to `node:util parseArgs` only when a script
  is touched for other reasons (decision); not in this plan.

### 7. Strict existence check

- **What:** `pathExistsStrict(path, { followLinks })` in `lib/file-exists.ts`:
  ENOENT is false, every other error throws.
- **Direction:** follow links (`stat`): `chat/session/delete/apply/storage.ts`,
  `commands/trash/command.ts`, `plugins/active.ts`,
  `cards/accept-submission.ts`, `agent-context-mirrors.ts`. No-follow
  (`lstat`): `triage/evidence/core.ts`, `triage/decisions/apply.ts`,
  `lib/state-migration.ts`. Directory checks (`box-identity.ts`,
  `bin/deferred-issues.ts`) stay.

### 8. Router comment

- **What:** `workstreams-app/src/router/effects.ts:137` says *"bin/ can't import
  beebox's guards"*. Reword to say the router keeps its own helpers by choice.

### 9. Atomic-write residuals

Accepted by the boxholder: `writeFileAtomic` keeps an existing file's mode and
replaces a symlinked target. Record the second in the helper's doc comment.

### 10. Clock-offset flake

- **What:** `test/core/chat/schedules.clock-offset.test.ts` "a check-in armed
  before an offset fires once the offset passes it" timed out once under load.
- **Why not `careful.txt`:** `beebox/test/careful.txt` says *"Any other
  timing-sensitive file is a flake to fix, not to add."*
- **Direction:** find the cause. A first guess (`fs.watchFile` taking its
  baseline after the file is written) did not reproduce: a direct test still
  delivered the event. Next: run the test under parallel load to reproduce,
  then fix the code or the test. If no cause is found in one session, file a
  bug with the evidence instead.

## Could this be simpler?

The simplest version merges only the exact copies, which the sweep already
did. It leaves eight elapsed-time formatters and 18 fence rules, so the next
fix lands in one copy, per §8. Within tracks, the simple choices are taken:
track 2 deletes instead of sharing a core; track 3 adds one offsets function
rather than a frontmatter editing library; track 6 does not touch async
callers or argv parsing.

## Subplans

none

## Failure modes

> **Critical gap:** none. Each new path has a test or keeps an existing one.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Wider fence rule reads a body line `--- ` as a closing fence | New test (trailing-space fence) | Rule requires the fence alone on its line | Clear in test |
| A card with a BOM now parses where it did not | New test | Intended | Visible: the card gains its fields |
| `frontmatterFence` offsets off by one with CRLF, breaking a line editor | New test per newline style | — | Silent without the test |
| Generator output changes for an existing snapshot test | Existing tests run | Update expectations | Clear |
| Quota CLI output changes shape | Moved test pins `[claude, codex]` | CLI omits GLM | Clear |
| Backend age text gains a date ("Sep 15") | New test with `dateAfterDays: Infinity` | Option | Clear |
| Health "overdue 2d" becomes "1d 23h" (floor vs round) | Updated expectations | By decision | Visible |
| Trash rename loses the job suffix | New test | `withCollisionStamp` | Clear |
| `git` trims porcelain leading spaces | New test | One trailing newline only | Silent without the test |
| `setFrontmatterFields` writes over malformed YAML | New test | Typed refusal | Clear |
| "fires in" shows `0ms` for a due check-in | New test | One-minute minimum kept | Clear |
| Issue search indexes frontmatter as body for a BOM file | New test | Shared fence rule | Silent without the test |
| Hook tool startup slows from a heavy import | — | `bin/lib/git.ts` imports only `node:child_process` | Visible as slower commits |

## Agent-flow / user-flow edge cases

- Wrong tag / wrong field: not applicable; no agent-facing vocabulary changes.
- Stale ref: not applicable.
- Two agents touching the same card: `setFrontmatterFields` keeps the callers'
  existing locks; ADDRESSED (no lock changes).
- Hand-edit drift: a hand-edited card with a BOM or trailing-space fence now
  parses; ADDRESSED in track 3.
- Fabricated free-form value: not applicable.
- Validation error UX: unchanged.
- Partial migration: old cards keep their folded YAML until next edited;
  `applyFieldEdits` keeps a file's existing folding. ADDRESSED.

## NOT in scope

- Rewriting existing cards to unfold YAML: they read the same; only new writes change.
- Slug helpers: their output names files already on disk.
- String-coercion helpers (`optionalString` and kin): four rules, no decision taken.
- `node:util parseArgs` migration of `bin` scripts: only when touched otherwise.
- Async `bin` git callers and `beebox/src/dev` git helpers: different mechanism or package boundary.
- The dev router's own helper copies: kept by choice (track 8 only fixes the comment).
- `schemas/capture-session.tsx` duration text: stored card data.

## Open design questions

none; all decisions were taken on 2026-10-23.

## Knowledge audits

Skip: no new agent-facing concept. The box agent sees the same card types,
fields and commands; only text formatting and parsing tolerance change.

## What will hold this after it ships

Unit tests on each shared function (fence forms, offsets, `setFrontmatterFields`,
`formatAgo`/`formatDuration`, `truncate`, `git` trimming and failure modes,
`pathExistsStrict`, the trash rename). The existing caller tests (health,
session context, deploy status, quotas) pin the visible text.

## Implementation order

1. Track 8 and 9 (comment-only).
2. Track 7 strict existence check.
3. Track 1 card filename type.
4. Track 5 escape and truncate.
5. Track 6 `bin` git helper.
6. Track 4 elapsed-time text (frontend import switch included).
7. Track 3 frontmatter: fence rule, then line editors, then generators, then editors.
8. Track 2 quota collection.
9. Track 10 flake.
One commit per track step; change-selected tests per track; cross-model
review of the whole set before landing.

## Rollout shape

Tests first per shared function, as listed above; done when those and the
change-selected suite pass. No data migration. No knowledge audits.
