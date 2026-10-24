---
title: "Backend duplication sweep: dates, text helpers, atomic writes and loaders"
status: draft
workstream: dup-sweep-backend
issues:
  - ../../../issues/code-quality/2026-10-23-date-and-duration-formatting-variants.md
  - ../../../issues/code-quality/2026-10-23-text-helpers-with-diverging-rules.md
  - ../../../issues/code-quality/2026-10-23-hand-rolled-atomic-writes-and-state-loaders.md
---
# Backend duplication sweep: dates, text helpers, atomic writes and loaders

This plan finishes the three duplication issues that the earlier sweep plan
([dup-sweep-backend-remaining](../implemented-plans/dup-sweep-backend-remaining.md))
left open. Each track moves copies that already behave the same onto one
helper. Where the copies behave differently, the plan keeps each rule and
records why, so the issue can close with a decision instead of an open list.

**Issues addressed:** the three in the frontmatter. Related, not changed:
[apostrophes lost in slugs](../../../issues/bugs/2026-09-02-apostrophes-lost-in-slugs-and-titles.md)
says the slugger stays as it is, and its fix is a title lookup at the
derivation sites. This plan does not touch those sites. The parent
[duplication sweep](../../../issues/code-quality/2026-10-22-functional-duplication-sweep.md)
stays open for its frontend pass.

## Design

No design section: every track keeps what a person or agent sees, except the
`bbx calendar` help text in track 2, which states a grammar that already exists.

## Smallest fix and budget

The smallest fix for each issue is a note that says the remaining copies are
intentional. That closes nothing that a reader can rely on: the box-local-day
fallback stays copied six times, and the `m` trap stays undocumented.

Chosen tracks and estimates (additions plus deletions, source and tests):

| Track | Estimate |
|---|---|
| 1. Box-local day and the timezone fallback | ~120 |
| 2. Duration parsers | ~60 |
| 3. Optional string helpers | ~250 |
| 4. ASCII slug | ~60 |
| 5. Atomic writes: git shim, exhibits | ~40 |
| 6. Strict JSON reads | ~120 |

Total about 650 lines. Docs: the three issue closures and two lines of
`bbx calendar` help and docs. This is not a BIG CHANGE.

## Stated preferences this plan trades against

- Behavior-preserving refactors only, unless a change is named here
  (the workstream brief). Each track names its behavior changes.
- `beebox/docs/module-map.md:8-14`: `src/shared/` imports nothing else in the
  package and uses no `node:` builtins. `src/lib/` may not import `core/`
  (`module-map.md:30`). This decides where each helper lives.
- Minimize invented concepts (boxholder feedback). Track 3 adds three
  functions, not a framework. Track 6 adds one function.
- The issue text for loaders: *"Which policy a store should have is a
  per-store decision: a silently reset store loses data, and a throwing one
  can block a feature."* This plan keeps every store's current policy and
  records the per-store reason (track 6).

## What already exists

- `loadBoxTimezone` (`src/core/box/config.ts:184`) returns `string | null` and
  warns on an invalid zone. Reuse.
- `getBoxTime` (`src/lib/time.ts`) gives the box clock (BBX_TIME, stubs,
  walk offset). Reuse; do not change which sites read it.
- `boxLocalDateEpoch(now, timeZone)` (`src/shared/todo-model.ts:387`) is
  already pure and shared. Rebuild it on the new day-string function.
- `parseDuration` (`src/scheduled-script-duration.ts:34`) has no imports.
  `bin/` already imports beebox modules (`bin/lib/schedules.ts:20`:
  *"import { errnoCode } from "../../beebox/src/shared/error-guards.js""*).
- `writeFileAtomic` (`src/lib/atomic-write.ts:80`) takes `mode` and Buffer
  content. `workstreams-app` already imports it
  (`workstreams-app/src/server/main/issue-index.ts:39`).
- `loadJsonStateOrFresh` (`src/lib/json-state.ts`) covers the lenient
  warn-and-reset policy. Extend the same module.
- `isRecord` (`src/shared/is-record.ts`) is the precedent for a small shared
  guard module.
- Searched for an existing shared slug helper (`export function slug`) and a
  string-guard module: none.

## Prior art (external)

No design decision depends on an external premise. `Intl.DateTimeFormat`
with `en-CA` giving `YYYY-MM-DD` is already relied on at three sites in this
repo.

## Ontology

- **Box-local day:** the `YYYY-MM-DD` calendar date an instant falls on in the
  box's timezone. Existing name: `boxLocalDay` (`connector-activity/core.ts:117`).
- **Box timezone:** the box config `timezone`, or the host zone when it is not
  set. New name for the fallback: `boxTimeZoneOrHost`. It is not the bare
  `loadBoxTimezone`, which some callers need as `null` (`cli/commands/remind/`
  makes a missing zone an error).
- **Duration (scheduled-script grammar):** `<number><s|m|h|d|w>`, `m` is
  minutes. Existing: `parseDuration`.
- **Schedule duration (schedules grammar):** `<positive integer><h|d|w>`, used
  for the duration fields in `schedule.yaml`. Today named `parseDuration` in
  `bin/lib/schedules.ts:57`. Renamed `parseScheduleDuration` here.
- **Timespan (`bbx calendar`):** `<integer>[d|w|m]`, `m` is months of 30 days.
  Existing: `parseTimespan`. It stays separate.
- **Optional string:** a value read from `unknown` that is used only when it is
  a string meeting a rule (any, non-empty, non-blank).
- **ASCII slug:** lowercase, runs of characters outside `[a-z0-9]` become one
  `-`, leading and trailing `-` trimmed.

## Tracks / scope

### Track 1: Box-local day and the timezone fallback

**What.** Four functions compute the box-local day, and six files repeat
`(await loadBoxTimezone(boxRoot)) ?? Intl.DateTimeFormat().resolvedOptions().timeZone`.

**Why.** Each copy is a place where the fallback can drift (one copy already
uses `formatToParts` and an invariant per part,
`core/triage/todo.ts:16-25`, for the same output as `.format`).

**Direction.**
- `src/shared/local-day.ts`: `localDay(now: Date, timeZone: string): string`.
  It assembles the `en-CA` year, month and day parts with `formatToParts` and
  an invariant per part, as `core/triage/todo.ts:18-24` does today. That is the
  stricter of the two existing forms: it does not depend on the locale's
  whole-date pattern. `boxLocalDateEpoch` in `shared/todo-model.ts` becomes
  `parseIsoDate(localDay(now, timeZone))` with its invariant.
- `src/core/box/config.ts`: `boxTimeZoneOrHost(boxRoot): Promise<string>`,
  next to `loadBoxTimezone`. The six fallback sites call it:
  `core/triage/todo.ts:17`, `core/todo/count.ts:53`, `core/todo/query.ts:29`,
  `core/todo/review-sweep.ts:44`, `cli/commands/calendar.ts:111`,
  `connector-activity/core.ts:118`.
- `boxLocalDay(boxRoot, now?: Date)` moves from `connector-activity/core.ts`
  to `core/box/local-day.ts`. A caller that passes `now` keeps its clock. When
  `now` is omitted, it reads `getBoxTime(boxRoot)` after the timezone load, the
  order `getTriageTodoDate` uses today. Its five callers
  (`core/schedule/scheduler/connector-activity-alert.ts:99`,
  `core/judgment/budget.ts:70`, `connector-activity/core.ts:174`,
  `connector-activity/episodes.ts:21`, `:32`) update their import.
- `getTriageTodoDate(boxRoot)` is deleted. Its three callers
  (`core/triage/decisions/apply.ts:175`, `:261`, `core/triage/run/routing.ts:217`)
  call `boxLocalDay(boxRoot)`.
- `boxTodayEpoch` (`core/todo/review-sweep.ts:43`) keeps its name and uses
  `boxTimeZoneOrHost`.

**Vocabulary lock-ins.** `localDay`, `boxTimeZoneOrHost`, `boxLocalDay`.

**First chunk.** All of the above in one commit. Test: `localDay` across a
date line (an instant that is the 23rd in UTC and the 22nd in
`America/Los_Angeles`).

### Track 2: Duration parsers

**What.** Three parsers. The two named `parseDuration` share a name and
differ in grammar. `parseTimespan` reads `m` as months.

**Why.** The shared name invites a caller to import the wrong one. An agent
that runs `bbx calendar 30m` gets 30 months of events. Every help line shows
`1m` with no unit name (`cli/commands/calendar.ts:70`:
*'Time range: "today", "3d", "2w", "1m" (default: 7d)'*).

**Direction.**
- `bin/lib/schedules.ts`: rename `parseDuration` to `parseScheduleDuration`, and
  `DURATION_PATTERN` to `SCHEDULE_DURATION_PATTERN`. Consumers: the schema at
  `bin/lib/schedules.ts:79` and `bin/schedules.test.ts:24`, `:61-65`.
  `formatDuration` keeps its name: it can emit `m` for a non-cadence value
  (`bin/lib/schedules.ts:73`), so it keeps the general name. The arithmetic
  stays local: three multiplications do not justify a cross-package import,
  and the narrow grammar is deliberate (its doc comment: *"No cron syntax"*).
- `parseTimespan` keeps its grammar. The help text becomes
  `'Time range: "today", "3d" (days), "2w" (weeks), "1m" (months) (default: 7d)'`,
  and the same unit names go in `docs/connectors/calendar.md:84`,
  `core/agent-guide/guide.md:437` and `core/agent-guide/ledger.yaml:507`.
  The error text names the units the same way.
- Named behavior change: none. Making `30m` an error was considered and
  rejected: it changes what an existing invocation does, and the help text
  removes the ambiguity at the place an agent reads it.

**First chunk.** Rename plus help text in one commit.

### Track 3: Optional string helpers

**What.** About twenty local helpers read an optional string from `unknown`
with one of three rules.

**Direction.** `src/shared/optional-string.ts`:

```ts
/** `value` when it is a string, else null. */
export function stringOrNull(value: unknown): string | null
/** `value` when it is a string other than "", else null. */
export function nonEmptyString(value: unknown): string | null
/** `value`, untrimmed, when it is a string with a non-space character, else null. */
export function nonBlankString(value: unknown): string | null
```

Callers that return `undefined` or `""` write `?? undefined` or `?? ""`.
Sites, by cluster from the survey:
- any string: `plugins/courseware/view/concept-data.ts:55`,
  `frontend/src/renderers/image.tsx:22`, `frontend/src/components/BrowserTaskView.tsx:176`,
  the `stringAttr` trio (`core/todo/extract/body.ts:295`, `shared/todo-text.ts:123`,
  `shared/markdoc-config/tags/core.ts:213`), `frontend/src/components/TodoViewCard.tsx:58`,
  `webapp/trpc/routers/status.ts:173`, `bin/lib/transcripts.ts:25` (`?? ""`),
  `frontend/src/components/CommentsThread.tsx:39`, `core/markdoc/emit-tags.ts:54`.
- non-empty: `connectors/google-drive/tracking.ts:234`,
  `frontend/src/components/CommentsThread.tsx:42`, `frontend/src/components/WebpageView.tsx:87`,
  `core/chat/review/run/husk-write.ts:85`, `plugins/recipe/view.tsx:113`.
- non-blank: `frontend/src/components/chat/native-composer-command.ts:134`,
  `.../InteractiveChat/native-emission.ts:129` and its inline copy at `:132`,
  `frontend/src/lib/pdf-card.ts:122`, `frontend/src/lib/docling/parse.ts:172`,
  `frontend/src/lib/docling/table.ts:14`, `core/search/extract/core.ts:277`,
  `frontend/src/components/PersonView/view.tsx:26`,
  `scripts/user-stories/validate-discovery.ts:72`.

A helper that takes `(record, key)` keeps a one-line local wrapper when it has
many callers, so call sites do not change shape. The rules stay distinct:
merging non-empty into non-blank would turn a whitespace-only title into
null, which is a behavior change.

**Vocabulary lock-ins.** The three names above.

**First chunk.** The module, its test (one case per rule: `""`, `" "`, `"a"`,
`1`), and every site.

### Track 4: ASCII slug

**What.** Five sites write the same slug expression.

**Direction.** `src/shared/ascii-slug.ts`: `asciiSlug(text: string): string`
(lowercase, `[^a-z0-9]+` to `-`, trim `-`). Sites:
`shared/markdoc-config/tags/core.ts:82` (`slugifyHeading`),
`dev/lib/prompt-viewer-data/naming.ts:17` (keeps its parenthetical pre-step),
`schedules/full-suite/lib.ts:373`, `site/workspace-model.ts:26` (keeps its tag
and entity pre-steps and `"section"` fallback),
`bin/lib/schedules-filing.ts:32` (keeps `.slice(0, 60)` at the call site, so a
cut may still end in `-`, as today).

Kept apart, with the reason recorded in the issue closure:
- `scripts/user-stories/stable-id.ts:28`: word-boundary cap, and its ids are
  persisted in issue frontmatter.
- `cli/commands/remind/reminder.ts:48` `textSlug`: NFKD and a word-boundary
  cap, and its output names existing cards on disk.
- `dev/prompt-report.ts:70`: keeps a leading `-` to match GitHub anchors.
- The three `sanitizeFilename` functions (`shared/filename.ts:44`,
  `core/bulk-upload/batch-format.ts:16`, `webapp/routes/chat/uploads.ts:45`)
  and the `\w`-class filename stems: each keeps `_` or case, and existing
  stored names depend on each rule (`batch-format.ts` re-runs must produce
  identical names).

**First chunk.** The helper, a test (`"  Hello, World!  "` gives
`hello-world`), and the five sites.

### Track 5: Atomic writes

**What.** Two remaining hand-rolled single-file writers and two Orama
persists that write a temp file through a library call.

**Direction.**
- `core/script-env/git-shim.ts:107-110`: `writeFileAtomic(file, { content: text, mode: 0o755 })`.
  This fixes a shared temp name (`${file}.${process.pid}.tmp`): two
  concurrent calls in one process write the same temp file.
- `workstreams-app/src/server/exhibits/app/api.ts:112-123`: delete the local
  `writeFileAtomic` and import beebox's. Its temp name stops being hidden.
  Checked: nothing lists `data/` (the only reader resolves one named file,
  `api.ts:273`), so the visible temp name has no reader.
  The call passes `createDir: false`, so a removed directory still fails the
  write as it does today. The shared helper also keeps an existing target's
  mode; exhibit data files are created with the default mode and nothing
  changes it, so the result is the same.

Left alone, with the reason in the closure:
- The two Orama persists (`core/search/store/index-store.ts:107-111`,
  `workstreams-app/src/server/main/issue-index.ts:328-330`) write their temp
  file through a library call. The search index persists under the refresh
  lock (`core/search/refresh/core.ts:87`), so its fixed `.tmp` name has one
  writer; the issue index already uses a unique temp name. Adding fsyncs to
  multi-megabyte index writes is not asked for.
- `lib/file-lock.ts:350` `writeSidecar`: a lock sidecar on every acquire; an
  fsync there adds latency to every lock for a file whose loss is recoverable.
- `workstreams-app/.../issues-mutation-service.ts:193`: a multi-file
  transaction.

**First chunk.** Both sites.

### Track 6: Strict JSON reads

**What.** Five loaders write `try { parse(JSON.parse(await readFile(...))) }
catch { if ENOENT return default; throw }`.

**Direction.** `src/lib/json-state.ts` gains
`readJsonIfPresent<T>(filePath: string, schema: z.ZodType<T>): Promise<T | undefined>`.
A missing file gives `undefined`. A read error, invalid JSON, or a schema
mismatch throws (`schema.parse`). Callers:
`core/quick-capture/store.ts:46` (`?? null`),
`lib/box-maintenance/admission.ts:97` (`?? null`),
`dev/perf/local-hub.ts:85`, `core/chat/routing/quick-chat-store.ts:42`
(`z.unknown()`), and `bin/lib/schedules-store.ts:93` only if its domain error
survives: it converts a schema failure into `InvalidStoreRecordError`, so it
uses `z.unknown()` and keeps its own `safeParse`.

Kept, with the per-store reason recorded in the issue closure:
- `install-validation-hooks.ts:314`: an empty file reads as `{}`.
- Fail-closed stores with a domain error (`webapp/box-config-write.ts:44`,
  `webapp/local-users.ts`, `transient-state.ts`): each error names its file
  for the person who must fix it.
- Lenient stores (csp-report runner state and cursor, turn-marker,
  issue-index manifest, oauth-state, hub state, retro registries,
  box-maintenance step): each holds a cache, a cursor, or short-lived claims
  whose loss costs repeated work or a retry. None holds data a person wrote.
  Their policies stay.
- `webapp/routes/chat/send-dedup.ts:83` is lenient too, with a different
  cost: its claims suppress a second send of the same message after a
  restart (`send-dedup.ts:75`), and an unreadable file loads as empty. The
  closure records this as an existing duplicate-send risk; the policy stays.

**First chunk.** The helper with a test (missing gives `undefined`, `{` throws,
a schema mismatch throws), and the callers.

## Could this be simpler?

The simplest version closes the issues with notes and changes no code. It
fails on the six-way timezone fallback (track 1) and the git shim's shared
temp name (track 5), which are real defects or drift points. Tracks 3 and 4
are the most optional: each site is a one-liner. They earn their place
because the copies already diverge into three rules, and a fourth copy is
written each time someone needs the rule; a named helper per rule stops that.
Track 6 could be dropped; it is kept because five copies of the same
try/catch are exactly what the issue reports, and the helper is one function.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A track 1 call site switches from the box clock to real time | Existing journey/triage tests use `BBX_TIME` | Signature keeps `now` explicit | Silent; caught by review of each call site |
| `localDay` output differs from `formatToParts` assembly | New test | `parseIsoDate` invariant in `boxLocalDateEpoch` | Clear (invariant) |
| A `bin/` caller still imports `parseDuration` from `bin/lib/schedules` | Typecheck | Rename | Clear |
| A non-empty site moved to non-blank by mistake | New rule tests | Cluster lists above | Silent; review each site |
| `asciiSlug` changes a filename that dedups against existing files | `schedules-filing` and full-suite tests | Cap kept at call site | Clear in tests |
| The exhibit write creates a missing `data/` it used to refuse | none | `createDir: false` | Clear (ENOENT) |
| `readJsonIfPresent` swallows a schema error | New test | `schema.parse` throws | Clear |

No critical gap.

## NOT in scope

- Changing any loader's policy.
- Apostrophe handling in slugs, and title derivation from refs.
- `stable-id`, `textSlug`, the `sanitizeFilename` functions, `prompt-report` anchors.
- Making `bbx calendar 30m` an error.
- `lib/file-lock.ts` sidecar writes and the two Orama index persists.
- The frontend pass of the parent sweep.
- `src/scripts/migrate/` and `scan-uploader/`.

## Review record

Cross-model plan review (codex gpt-6-sol), 2026-10-23. Accepted: drop the
Orama callback writer; keep `formatToParts` and the clock-after-timezone order
in track 1; rename only the cadence parser and list its consumers; record the
send-dedup risk; pass `createDir: false` for exhibits. Rejected: cutting
tracks 3, 4 and 6 as optional, because the boxholder asked for all three
issues ("Do all of them!").

## Implementation order

Tracks 1 to 6, one commit each, then cross-model review of the diff, then
the three issue closures in one commit.
