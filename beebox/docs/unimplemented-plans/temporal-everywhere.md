---
title: "Temporal everywhere: replace Date across beebox, workstreams-app, bin and Clerk"
status: parked
workstream: web-guidance-scan
issues:
  - ../../../issues/closed/exploration/2026-11-10-adopt-modern-web-guidance-skill.md
---
# Temporal everywhere: replace Date across beebox, workstreams-app, bin and Clerk

**Parked 2026-11-12 by the boxholder.** A cross-model review found the full
conversion would break working behavior in five places (persisted usage day
buckets, async polyfill ordering at module load, two missed child processes,
all-day calendar events shifting a day, fractional file mtimes) for little
user-visible gain over a targeted fix. The boxholder's direction instead:
store UTC; use the box's timezone mostly for display, or explicitly where a
format carries a zone (for example `.ics`); avoid an async polyfill. The real
date bugs this plan found are tracked in
[date bugs found by the Temporal census](../../../issues/bugs/2026-11-12-date-bugs-found-by-temporal-census.md).


This plan moves all date and time code from `Date` to `Temporal`: the beebox
server, CLI, connectors, schemas and frontend, `workstreams-app`, the root
`bin/` and `schedules/` scripts, `beebox-clerk`, and their tests. A lint ban on
`Date` then holds the line, with a few line-level exceptions for libraries
and protocols that hand us or require a `Date`.

**Issues addressed:**

- `issues/exploration/2026-11-10-adopt-modern-web-guidance-skill.md` — the
  workstream umbrella. Its plan, `modern-web-guidance-adoption.md` Category
  G, moved three frontend modules; this plan finishes the move.
- Related, not resolved, and therefore not in `issues:` (the finish skill
  closes every listed issue):
  `issues/features/2026-10-27-schedules-ignore-the-box-timezone.md`. This plan
  keeps the scheduler's zone behavior exactly (see Track 3), so that issue
  stays open and becomes a small change on top of this plan.
- Searched `bin/issues search --all` for Temporal, timezone, "time zone",
  UTC, Date.now, "new Date", toISOString, DST, box-local, "local day", cron,
  BBX_TIME, getBoxTime, clock, date-only and polyfill. Every other hit is
  closed (for example
  `issues/closed/code-quality/2026-10-23-date-and-duration-formatting-variants.md`,
  `issues/closed/bugs/2026-11-01-access-log-test-fails-across-a-month-boundary.md`,
  `issues/closed/bugs/2026-10-18-calendar-ics-labels-unconverted-time-with-event-zone.md`)
  or unrelated. No open issue duplicates this plan.

## Design

No design section: this is a refactor of how code represents dates and
times. Five places change what a person or agent sees, each a day-boundary
fix listed in Track 3 (husk file date, the procedure prompt's date, `bbx
usage` days, the daily backup's day, and `bbx calendar` day bounds and
times). None adds a surface, a card type or a behavior.

## Smallest fix and budget

**BIG CHANGE — needs the boxholder's approval of the size.** The boxholder
approved the scope and the order (this plan third in the workstream), not
this size.

**Smallest fix.** Move only the sites where `Date` causes a real bug today
(UTC-sliced days, host-zone days, hand-rolled zone offsets, fixed-millisecond
day arithmetic): about 15 files, about 800 changed lines with tests, and a
lint rule against `new Date(<date-only string>)`.

**Chosen design.** A full move, per the boxholder's decision: *"for things
like Temporal, we should plan to do full updates across the box"*, with tests
in scope (*"Ban Date in tests too"*). Counts below are changed lines
(additions plus deletions), measured from today's code: 1,340 non-comment
source lines under `beebox/src` (outside the frontend) name `Date`,
`toISOString`, `getTime()`, `getBoxTime`, `toLocale{Date,Time}String`,
`Intl.DateTimeFormat` or a 10-character slice; 113 in the frontend; 798 in
beebox tests; 103 in `workstreams-app`; 194 in `bin/` and `schedules/`
sources plus 102 in their tests; 4 in Clerk. Most touched lines become one
deleted and one added line, so the count is about twice the touched lines,
plus signature ripples and new tests.

| Track | Source | Tests | Docs |
|---|---|---|---|
| 1. Runtime foundation | 60 | 60 | 0 |
| 2. Time vocabulary and box clock | 350 | 250 | 0 |
| 3. Zones, days and schedules | 650 | 450 | 10 |
| 4. Server sweep (and delete `getBoxTime`) | 2,100 | 500 | 20 |
| 5. Frontend sweep | 260 | 80 | 5 |
| 6. Test-only sweep | 0 | 650 | 0 |
| 7. workstreams-app, bin, schedules, Clerk | 640 | 250 | 10 |
| 8. Lint ban and guidance | 150 | 0 | 40 |
| **Total** | **about 4,200** | **about 2,250** | **about 85** |

Total: about 6,450 changed lines of source and tests (a likely range of
5,500–7,000), plus about 85 lines of docs. No generated output is committed.
The earlier census estimated 2,500–3,300 without tests; it counted about one
line per site, and this table counts additions plus deletions. About half
the lines are mechanical (`new Date().toISOString()` 140 sites,
`getBoxTime(` 92, `getBoxTimeISO(` 75, `Date.now()` 283); the rest need a
per-site decision (which zone, which clock, what to do with bad input).

What the full move buys over the smallest fix: one representation per
concept, so a reader never asks whether a `Date` holds a calendar day or an
instant; and a lint ban that can be absolute. A partial ban cannot tell
`new Date("2026-08-14")` (a bug) from `new Date(ms)` (fine), so the bug
class would come back.

## Stated preferences this plan trades against

- **Boxholder decisions (binding):** full move, not piecemeal; scope is all
  of `beebox/src`, `workstreams-app`, root `bin/` scripts, `beebox-clerk` and
  tests; a lint ban afterwards with only narrow interop exceptions; one way to
  do each thing; strict by default without over-engineering rare failures.
- **Principle 8, one way to do each thing**
  (`beebox/docs/engineering-principles.md:95`): one clock helper per clock,
  one ISO serializer, one date-only parser, one installer for the polyfill.
- **Principle 11, enforcement beats convention** (`:127`): the plan ends in a
  lint ban, not a doc rule.
- **Principle 3, validate at boundaries** (`:37`) and **principle 4, never
  silent** (`:49`): a bad `BBX_TIME` throws; untrusted text goes through one
  safe parser that returns `null`, and the caller reports it.
- **Principle 6, right-sized defensiveness** (`:75`) and the memory "stop
  over-engineering rare failures": a missed polyfill install fails loudly with
  `ReferenceError: Temporal is not defined`; the plan does not add a lint rule
  or a registry to prove every entry point installs it.
- **`beebox/code-style.md:80`:** *"Line-level only — a single
  `// eslint-disable-next-line <rule> -- <concrete justification>`. Never a
  file-level or rule-level disable"*. So the interop exceptions are
  line-level disables inside one module, not a config `ignores` entry.
- **`beebox/AGENTS.md:171`:** *"Work only on the requested problem."* The
  scheduler's zone semantics, stored formats and duration grammars stay as
  they are (see NOT in scope), although Temporal makes each easy to change.
- **Shipped precedent:** `modern-web-guidance-adoption.md` Category G (the
  frontend loader, `FriendlyDate`, `item-logic`, `CalendarView`) and
  `ui-primitives-dedup.md` Track 10 (the `toLocaleTimeString` /
  `toLocaleDateString` ban in `src/frontend/eslint.config.ts:306-320`).

## What already exists

- **Polyfill package.** `beebox/package.json:194` *`"temporal-polyfill":
  "1.0.7"`* in `dependencies`; also `src/frontend/package.json:35`. Reuse.
- **Frontend loader.** `src/frontend/src/lib/temporal.ts:10-11`
  *`export function ensureTemporal(): Promise<void> { return
  ensureTemporalWith(() => import("temporal-polyfill/global"));`*, awaited in
  `src/frontend/src/main/app.tsx:77` *`await Promise.all([ensureTemporal(),
  bootstrapFileTypeRegistrations()]);`*. Reuse unchanged.
- **Node one-off install.** `src/cli/commands/view/render-one.ts:153` *`if
  (!("Temporal" in globalThis)) await import("temporal-polyfill/global");`*.
  Rebuild onto the shared installer (Track 1).
- **Frontend test install.** `src/frontend/test/helpers/temporal-global.ts:8`
  *`import "temporal-polyfill/global";`*, pulled in by
  `src/frontend/test/helpers/dom-globals.ts:10`. Replaced by the `.taprc`
  preload, which already applies to frontend tests (`beebox/.taprc:34`
  *`- src/frontend/test/**/*.test.ts`*).
- **Types.** `src/frontend/tsconfig.json:5` *`"lib": ["ES2023", "DOM",
  "DOM.Iterable", "ESNext.Temporal"]`*. The backend does not have it:
  `beebox/tsconfig.json:27` *`"lib": ["ES2024"]`* and
  `beebox/tsconfig.base.json:25` *`"lib": ["ES2023", "DOM",
  "DOM.Iterable"]`* (the base is exported to boxes, `package.json:23`
  *`"./tsconfig.base.json": "./tsconfig.base.json"`*). Add to both.
- **Box clock.** `src/lib/time.ts:54` *`export function getBoxTime(boxRoot?:
  string): Date {`*, resolving `BBX_TIME`, then `../stubs.yaml`, then
  `Date.now() + offsetMs` (`:56-71`), plus `getBoxTimeISO` (`:134-136`) and
  `boxClockShiftMs` (`:124-129`). Rebuild to return `Temporal.Instant`.
- **Frontend box clock.** `src/frontend/src/lib/box-clock.ts:42-44`
  *`export function boxNow(): number { return Date.now() + shiftMs; }`*.
  Keep its epoch-millisecond shape; only `Date.now()` changes.
- **Box-local day.** `src/shared/local-day.ts:12` *`export function
  localDay(now: Date, timeZone: string): string {`* and
  `src/core/box/local-day.ts:11` *`export async function boxLocalDay(boxRoot:
  string, now?: Date): Promise<string> {`*. Rebuild on Temporal.
- **Date-only parsing.** `src/shared/todo-model.ts:99` *`export function
  parseIsoDate(value: string): number | null {`* (UTC-midnight epoch with a
  `Date.UTC` round-trip check) and `:388` *`export function
  boxLocalDateEpoch(now: Date, timeZone: string): number {`*. Rebuild to
  return `Temporal.PlainDate`.
- **Box timezone.** `src/core/box/config.ts:254-255` *`export async function
  boxTimeZoneOrHost(boxRoot: string): Promise<string> { return (await
  loadBoxTimezone(boxRoot)) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;`*.
  Reuse. Zone validation (`:217-223`) constructs `Intl.DateTimeFormat`, which
  is not `Date`; leave it.
- **Views guidance.** `src/core/views/doc/files.ts:205-214` already
  says *"`Temporal` is a global in views"* and gives the date-only and
  instant rules; `src/core/views/advice/types.ts:41-44` has the
  `date-string-parse` and `utc-today` advice. Reuse; nothing to add.
- **Display helpers.** `src/shared/relative-time.ts` (`formatAgoMs`,
  `formatAgo`, `formatDuration`) takes epoch milliseconds; only `formatAgo`
  (`:35-37`) uses `Date`. `friendlyDate`/`<FriendlyDate>` own browser date
  text (`src/frontend/eslint.config.ts:306-308` *"FriendlyDate and
  friendlyDate own the browser's date and time text"*). Reuse.
- **Wire and storage are strings already.** No `z.date` or `z.coerce.date`
  in `src/` (searched, zero hits). YAML reads with the core schema, which has
  no timestamp type: `src/lib/read-yaml.ts:23` *`import { CORE_SCHEMA, load }
  from "js-yaml";`*; no `instanceof Date` in non-test `src/` (searched, zero
  hits). So `Temporal` values never need to cross a wire or a file.
- **Zone-correct wall-time conversion, hand-rolled.**
  `src/cli/commands/remind/time.ts:32-73` (`wallTimeIn`, `offsetMinutes`,
  `instantsForWallTime`) and
  `src/connectors/google-calendar/ics.ts:16-56` (`wallTimeIn`, `toMinutes`).
  Rebuild with `Temporal.ZonedDateTime`.

## Prior art (external)

- **Native Temporal in Node 24: absent.** Verified here: `node -v`
  v24.18.0, `typeof Temporal` is `undefined`. Engines pin `>=24.11.0 <25`.
  So every Node process needs the polyfill. Adopted premise.
- **Native Temporal in Chrome: shipped in Chrome 144** (stable 2026-01-13),
  on by default; Firefox since 139; Safari not yet.
  https://developer.chrome.com/release-notes/144 ,
  https://www.infoq.com/news/2026/02/chrome-temporal-date-api . Clerk runs
  only in Chrome, so it uses native Temporal and declares
  `minimum_chrome_version: "144"`. Adopted premise.
- **`temporal-polyfill/global` side effects, measured here.** It installs
  `globalThis.Temporal`, replaces `Intl.DateTimeFormat` with a wrapper that
  formats Temporal values, adds `Date.prototype.toTemporalInstant`, and leaves
  `Date.prototype.toLocaleString` alone. Evaluated-only.
- **Cost, measured here on this machine (Node 24.18).** Importing the global:
  8–12 ms once per process. `Instant.toString({fractionalSecondDigits: 3})`:
  1.4 µs against 0.5 µs for `toISOString`. `Instant.from(iso)`: 1.2 µs.
  Box-local "today" in a zone: 5 µs. `Temporal.Now.instant().epochMilliseconds`:
  0.39 µs against 0.04 µs for `Date.now()`. None of these matter at the call
  rates in this codebase; the clock-reading choice in Track 2 rests on test
  mocking, not speed.
- **Parsing strictness, verified here.** `Temporal.Instant.from` throws
  `RangeError` on `2026-08-14`, `2026-08-14 10:00`, `2026-08-14T10:00` and
  `Fri, 14 Aug 2026 10:00:00 GMT`; it accepts `2026-08-14T10:00:00+02:00`.
  `Instant.toString()` drops a zero fraction (`2026-08-14T09:30:00Z`), so
  storage must pass `fractionalSecondDigits: 3` to match `toISOString`.
- **ESLint, verified here against `beebox/eslint.config.ts`.**
  `no-restricted-globals` with `Date` reports `new Date()` and `Date.now()`
  but not `d: Date` or `type T = Date | null`.
  `@typescript-eslint/no-restricted-types` with `{ types: { Date: … } }`
  reports both type positions. Neither rule is set anywhere in the preset or
  the package configs (searched), so adding them replaces nothing. Adopted.
- **No other date library is in use** (no date-fns, dayjs, luxon or moment;
  census). Date-taking libraries are `cron-parser`, `cronstrue`, `rrule` (the
  census missed it: `src/scheduled-script-fields.ts:13` *`import rrulePkg
  from "rrule";`*) and `ical.js`. They stay at their boundaries.

No adopted item is copied code, so `ACKNOWLEDGEMENTS.md` does not change.

## Ontology

Existing nouns keep their names. New names are marked **new**.

- **Instant** — a point in time, `Temporal.Instant`. Not a calendar day, not
  a wall time. In memory only; stored and sent as an ISO timestamp.
- **ISO timestamp** — the stored and wire form of an instant:
  `YYYY-MM-DDTHH:mm:ss.sssZ`, always three fraction digits and `Z`, the same
  bytes `toISOString()` writes today. Produced only by `isoTimestamp`.
- **Calendar day** — `Temporal.PlainDate`. Card fields `due`, `start`,
  `recheck`, `created`, `retrieved`, `until` (date-only form). Stored as
  `YYYY-MM-DD`. Has no zone.
- **Box zone** — the IANA zone from `boxTimeZoneOrHost`
  (`src/core/box/config.ts:254`). Exists today.
- **Box-local day** — the calendar day an instant falls on in the box zone.
  Exists today as `localDay`/`boxLocalDay`; becomes `dayIn` (**new**) and
  `boxLocalDay` returning `Temporal.PlainDate`.
- **Box clock** — the box's "now", honoring `BBX_TIME`, `stubs.yaml` and the
  walk clock offset (`src/lib/time.ts:4-9`). Read with `getBoxInstant`
  (**new**, replaces `getBoxTime`) and `getBoxTimeISO` (exists, same output).
- **Wall clock** — the machine's real "now" in epoch milliseconds, for
  timers, deadlines, elapsed time, ids and ordering keys. Read with `nowMs`
  (**new**), the only call to `Date.now()`. `nowIso` (**new**) is its ISO
  timestamp. Not the box clock: a frozen `BBX_TIME` does not stop a lock's
  deadline.
- **Frontend box clock** — `boxNow()` (`src/frontend/src/lib/box-clock.ts:42`),
  epoch milliseconds; exists; unchanged except that it reads `nowMs()`.
- **Elapsed time / duration** — a number of milliseconds. Not
  `Temporal.Duration`: no `Date` is involved, and the formatters in
  `shared/relative-time.ts` take milliseconds.
- **Legacy `Date` boundary** — `toLegacyDate(instant)` and
  `instantFromLegacyDate(date)` (**new**), for `cron-parser`, `rrule`,
  `cronstrue` and `ical.js`. The only code outside the time module that holds
  a `Date` is the expression passed to or returned from those libraries.
- **HTTP date** — RFC 9110 `IMF-fixdate` text (`Last-Modified`, `Date`
  headers). `httpDate(instant)` and `parseHttpDate(text)` (**new**), because
  Temporal does not read or write that form.
- **Time module** — **new** `src/shared/time.ts`: the helpers above that both
  runtimes need (`nowMs`, `nowIso`, `isoTimestamp`, `parseInstant`,
  `parsePlainDate`, `dayIn`, `toLegacyDate`, `instantFromLegacyDate`,
  `httpDate`, `parseHttpDate`). It holds every line-level `Date` lint
  exception in beebox. Not the box clock, which reads files and lives in
  `src/lib/time.ts`.
- **Polyfill installer** — **new** `src/lib/temporal-global.ts`: a
  side-effect module that installs the polyfill when `Temporal` is missing.
  Not imported by browser code; the browser uses `ensureTemporal`.
- **Schedule datetime** — the `at`/`until` field forms the scheduler accepts
  today (`src/scheduled-script-fields.ts:41` *`ISO_DATETIME_SHAPE`*):
  date-only (read today as UTC midnight), zone-less date-time (read today in
  the host zone), or with an offset. Parsed by **new** `parseScheduleDateTime`
  with exactly those meanings.

## Tracks / scope

Execute in order. Every track ends with `pnpm typecheck`, `pnpm lint:changed`,
`pnpm layout-check` and `pnpm test:changed` from `beebox/` (the package
equivalents in other packages), and a review of every changed snapshot or
fixture string. While the sweep runs, the remaining work for a directory is
`pnpm exec eslint <dir> --rule '{"no-restricted-globals":["error","Date"]}'
--rule '{"@typescript-eslint/no-restricted-types":["error",{"types":{"Date":"x"}}]}'`.

### Track 1 — Runtime foundation

- **What.** Make `Temporal` a global in every Node process that runs beebox
  code, and give the backend its types.
- **Why this needs to change.** Node 24 has no Temporal. Today only `bbx view
  check` installs it (`render-one.ts:153`), so any server use crashes.
- **Direction.**
  - `src/lib/temporal-global.ts`: `if (!("Temporal" in globalThis)) await
    import("temporal-polyfill/global");` (top-level await; ESM).
  - First import in each entry: `src/cli/entry/bootstrap.ts` (the `bbx`
    entry, bundled into `dist/cli.mjs`, `bundle.ts:35`; `packages: "external"`
    at `:50` keeps the polyfill a runtime dependency, which it is), and
    `src/webapp/server-main.ts` (run directly by `bbx serve --watch`,
    `serve.ts:187-191`).
  - The public exports `src/exports/cards.ts`, `schema.ts`, `server.ts`
    import it, because box code, the hub and `workstreams-app` load them
    without `bootstrap.ts`. `exports/server.ts:2-5` says *"Importing this has
    no side effects"*; that sentence changes to name the one side effect.
  - Spawned children that bypass the CLI get `--import
    <PACKAGE_ROOT>/src/lib/temporal-global.ts` after `--import tsx`: the
    migration runner (`src/core/migration-run.ts:114`), the box-function
    runner (`src/core/webpage/box-function/core.ts:96`), tricks
    (`src/cli/commands/trick.ts:143`), the perf hub daemon
    (`src/dev/perf/hub/cli.ts:111`), and the test helper `tsxChild`
    (`test/helpers/child-process.ts:33`). Children that run `bbx`
    (`box-backup/local-runner.ts:99`, hub `child-spawn.ts:95`,
    `maintenance/controller.ts:141`) pass through `bootstrap.ts` and need
    nothing.
  - `beebox/.taprc` `node-arg`: `--import=./src/lib/temporal-global.ts` after
    `--import=tsx`. Delete `src/frontend/test/helpers/temporal-global.ts` and
    its import in `dom-globals.ts:10`.
  - `render-one.ts:150-153` imports the shared installer.
  - `"ESNext.Temporal"` added to `lib` in `beebox/tsconfig.json` and
    `beebox/tsconfig.base.json` (the second gives box code the types).
  - Dev scripts under `src/scripts/` and `src/dev/` that run standalone get
    the installer as their first import when Track 4 first makes them use
    Temporal; a missed one fails with `ReferenceError` on its first run.
- **Vocabulary lock-ins.** `src/lib/temporal-global.ts` is the one installer
  path for Node; `ensureTemporal` stays the one for browsers.
- **First implementation chunk.** The installer, the two entry imports, the
  three export imports, the five `--import` additions, `.taprc`, the two
  `lib` entries and `render-one.ts`. Tests: a migration-run test that runs a
  fixture script printing `typeof Temporal` and checks `"object"`; the same
  for the box-function runner. The existing CLI child tests cover
  `bootstrap.ts`. Run `bbx view check` on a stock view against the test box
  clone.

### Track 2 — Time vocabulary and box clock

- **What.** Add the time module, rebuild the box clock and box-local day on
  it, and move the todo date model to `Temporal.PlainDate`.
- **Why this needs to change.** Every later track calls these helpers. The
  todo model is the main date-only consumer, and `parseIsoDate` returning a
  UTC-midnight epoch is the representation that let UTC/local bugs in.
- **Direction.** Signatures in `src/shared/time.ts`:
  - `nowMs(): number` — `Date.now()` with the one line-level disable.
    Decision: elapsed and deadline math stays epoch milliseconds read here.
    Not `performance.now()` (deadlines are persisted and compared across
    processes, `src/lib/file-lock.ts:470` *`const deadline = Date.now() +
    waitMs;`* and lock metadata) and not `Temporal.Now.instant()` (four tests
    patch `Date.now` or use `mock.timers` with `apis: ["setInterval",
    "Date"]`, `test/core/scan/promote-debounce.test.ts:51`; a native
    `Temporal.Now` would not see that mock).
  - `nowIso(): string` — the wall clock as an ISO timestamp; replaces the 140
    `new Date().toISOString()` sites without changing which clock they read.
  - `isoTimestamp(instant: Temporal.Instant): string` —
    `instant.toString({ fractionalSecondDigits: 3 })`. Decision: storage keeps
    millisecond-precision `…sssZ`, byte-identical to `toISOString`, so no
    stored card, state file or fixture string churns.
  - `parseInstant(text: string): Temporal.Instant | null` — an RFC 3339
    timestamp with `Z` or an offset; `null` for anything else. Decision: the
    one safe parser for text the code did not write (frontmatter, headers
    from tools, user input, git output). Callers that today test
    `Number.isNaN(Date.parse(x))` test `=== null`.
    Text the code wrote itself (its own state files, its own fields validated
    by a Zod `datetime` schema) uses `Temporal.Instant.from`, which throws: a
    corrupt own-written timestamp is a broken invariant, and principle 4
    says not to be resilient to it.
  - `parsePlainDate(text: string): Temporal.PlainDate | null` — `YYYY-MM-DD`
    only (the regex in `todo-model.ts:91` stays the gate, then
    `Temporal.PlainDate.from(text, { overflow: "reject" })`, which refuses
    `2026-02-30`).
  - `dayIn(instant, timeZone): Temporal.PlainDate` — replaces `localDay`.
  - `toLegacyDate(instant): Date`, `instantFromLegacyDate(date: Date):
    Temporal.Instant`, `httpDate(instant): string`, `parseHttpDate(text):
    Temporal.Instant | null`.
  `src/lib/time.ts`:
  - `getBoxInstant(boxRoot?: string): Temporal.Instant`. Decision: replace
    `getBoxTime`, do not keep it alongside. During Tracks 2–4 `getBoxTime`
    is a two-line wrapper over `getBoxInstant` so each commit typechecks;
    Track 4 migrates its last callers and deletes it.
  - `BBX_TIME` and `stubs.yaml` `time` parse with `Temporal.Instant.from` and
    throw `Error("BBX_TIME is not an ISO timestamp with an offset: \"…\"")`
    on bad input. Today `new Date(envTime)` (`:58`) yields an Invalid Date
    that propagates silently. Every current value has `Z` (surveyed: all
    `BBX_TIME` literals in tests and scripts, and field-test `startTime`,
    which `src/field-test/scenario.ts:93` validates as *`z.iso.datetime({
    offset: true })`*).
  - `getBoxTimeISO` returns `isoTimestamp(getBoxInstant(boxRoot))`, same
    bytes. `boxClockShiftMs` uses `epochMilliseconds`.
  `src/core/box/local-day.ts`: `boxLocalDay(boxRoot, now?:
  Temporal.Instant): Promise<Temporal.PlainDate>`. Delete
  `src/shared/local-day.ts`.
  `src/shared/todo-model.ts`: `parseIsoDate` is replaced by
  `parsePlainDate`; `resolveStartEpoch` becomes `resolveStart(start, due):
  Temporal.PlainDate | null` with `due.subtract({ days })`/`{ weeks }`;
  `TodoPlateContext.now: Temporal.Instant`; comparisons use
  `Temporal.PlainDate.compare`. `boxLocalDateEpoch` is deleted.
  `src/core/todo/review-state.ts:88-99` stores `lastSweepDateEpoch` and
  `review.sweptOn` as numbers in `.beebox/todo-review-sweep.json`. Decision:
  keep the stored numbers; convert at load and save with two local functions
  (`PlainDate` ↔ UTC-midnight epoch), so no state file changes.
  Frontend `components/todo/item-logic.ts:87-88` (`calendarDay`, epoch to UTC
  `PlainDate`) is deleted; chips read `parsePlainDate` directly.
- **Vocabulary lock-ins.** The helper names above; `getBoxInstant`;
  `boxLocalDay` returns `PlainDate`; stored timestamps stay `…sssZ`.
- **First implementation chunk.** `src/shared/time.ts` with tests (each
  helper's accept and reject cases, including the four strings
  `Instant.from` rejects and a round trip that `isoTimestamp(Instant.from(x))
  === x` for `toISOString` output), `getBoxInstant` with the strict
  `BBX_TIME` parse and the wrapper `getBoxTime`, `getBoxTimeISO` on it, and
  `test/lib/time.test.ts` extended with a bad-`BBX_TIME` case. Then a second
  commit for `boxLocalDay`, `todo-model.ts`, `review-state.ts` and
  `item-logic.ts`.

### Track 3 — Zones, days and schedules

- **What.** Move the code that does zone math, day boundaries or calendar
  arithmetic, deciding the zone at each site.
- **Why this needs to change.** These are the sites where `Date` gives wrong
  answers today: hand-rolled offsets, host-zone days on a UTC production host
  (the open issue records *"The production server is UTC (`timedatectl`:
  `Etc/UTC`, checked 2026-10-27)"*), UTC-sliced days shown as the box's day,
  and fixed 24-hour day spans across DST.
- **Direction, per site.** Rule: a day a person or agent reads is the
  box-local day; a machine-level key keeps UTC.
  - `src/core/chat/husk.ts:43` *`${date.toISOString().slice(0, 10)}_…`* and
    `:103` *`opts.date ?? new Date()`*: box-local day, from the box clock.
    The date only names new husk files; lookup is by session id
    (`findChatHuskEntry`, `:91`). Old files keep their names.
  - `src/core/procedure/engine/phase.ts:315` *`const date =
    getBoxTime(boxRoot).toISOString().slice(0, 10);`* feeding *"Current date:"*
    in the agent prompt: box-local day. At 18:00 in Los Angeles it reads
    tomorrow today.
  - `src/core/usage.ts:191,326` *`timestamp.slice(0, 10)`*: box-local day.
    `bbx usage` is a person-facing report for one box; UTC days split an
    evening across two rows.
  - `src/core/box-backup/scheduled.ts:30-32` (`getFullYear/getMonth/getDate`,
    host zone): box-local day; `scheduledBackupDecision` gains a `timeZone`
    argument. The `MIN_DAILY_GAP_MS` guard (`:33`) is unchanged.
  - `src/cli/commands/calendar.ts:56-65` (`setHours`, host zone), `:73`
    *`const now = new Date();`* (wall clock, not box clock), `:86` *`to = new
    Date(from.getTime() + ms);`* (fixed milliseconds): box clock, box zone,
    `ZonedDateTime.startOfDay()` and `add({ days })`.
  - `src/core/secrets/access-log.ts:107-108`: stays UTC months. Its comment
    (`:95-97`) says *"`now` is the machine's clock, not a box's: the log is
    machine-level"*. Becomes `PlainYearMonth` arithmetic in `UTC`.
  - `src/connectors/google-calendar/event-filename.ts:27`
    *`event.start?.dateTime?.slice(0, 10)`*: unchanged string slice. It is
    the event's own date as Google wrote it, it names stored files, and it
    names no `Date`.
  - `src/cli/commands/remind/time.ts:32-73`: replace `wallTimeIn`,
    `offsetMinutes`, `instantsForWallTime` with
    `Temporal.PlainDateTime.from(…).toZonedDateTime(zone, { disambiguation:
    "reject" })` for the refusal of gaps and overlaps the header (`:7-10`)
    promises; keep the messages.
  - `src/connectors/google-calendar/ics.ts:16-56,127-160`: wall time via
    `Instant.from(dateTime).toZonedDateTimeISO(tz).toPlainDateTime()`; the
    generated VTIMEZONE reads January and July offsets from
    `ZonedDateTime.offset` for the box clock's year (today
    `new Date().getFullYear()` at `:132`, the host wall clock). Output bytes
    stay the same for the same year (golden test).
  - `src/connectors/google-calendar/utils.ts:135-136` (`toJSDate()`),
    `:265`, `:293-313` (`toLocale…String("en-US")` in the host zone) and
    `notes.ts:129-137` (`formatEventDate`, host zone): `CalendarEvent.start`
    and `end` become `Temporal.Instant` via `instantFromLegacyDate`; display
    formats in the box zone with `toZonedDateTimeISO(zone).toLocaleString(
    "en-US", …)`. This fixes `bbx calendar` and calendar commit messages
    showing UTC times on the production host.
  - `src/connectors/google-calendar/state.ts:307-318`,
    `connector.ts:197-200` (`setDate(getDate() ± n)`): `ZonedDateTime`
    `subtract`/`add({ days })` in the box zone, so the window stays
    wall-clock days across DST.
  - `src/core/session-context.ts` (`localParts`, `formatLocalTime`) and
    `src/core/agent/invoke/simulated-clock.ts:15`: take an `Instant`;
    `timezone: null` keeps meaning the host zone (`Temporal.Now.timeZoneId()`),
    as today.
  - **Scheduler** (`src/schemas/scheduled-script/due.ts`,
    `src/core/schedule/health.ts`, `describe.ts`,
    `src/scheduled-script-fields.ts`, `src/cli/tick-helpers.ts`,
    `tick-utils.ts`). Decision: keep the scheduler's zone behavior exactly.
    `cron-parser` keeps reading the host zone (`due.ts:146-148`, no `tz`),
    `rrule` keeps UTC, and `at`/`until` keep their three meanings through
    `parseScheduleDateTime` (date-only is UTC midnight, zone-less is
    `Temporal.Now.timeZoneId()`, an offset is itself). Changing any of these
    shifts the run time of existing cards on the production box with a
    timezone, which is a change of stored meaning (bbx-migration: *"Old data
    still loads but now means the wrong thing → migration"*) and belongs to
    `2026-10-27-schedules-ignore-the-box-timezone.md`. The library calls take
    `toLegacyDate(now)` and return through `instantFromLegacyDate`;
    `ScheduleCheckContext.now` becomes `Temporal.Instant`; comparisons use
    `Temporal.Instant.compare`. `DatetimeField` (`:44-47`) validates through
    `parseScheduleDateTime`.
- **Vocabulary lock-ins.** `parseScheduleDateTime`; `CalendarEvent.start`
  and `end` are instants; `scheduledBackupDecision({ …, timeZone })`.
- **First implementation chunk.** `remind/time.ts` on `ZonedDateTime`, with
  its existing tests unchanged plus a spring-forward gap and a fall-back
  overlap in `America/Los_Angeles`. Real run: `bbx remind --at` against the
  test box clone, comparing the written `at` with the pre-change output.

### Track 4 — Server sweep

- **What.** Every remaining `Date` in `beebox/src` outside the frontend,
  directory by directory: `core/` (627 touched lines), `webapp/` (159),
  `cli/` (126), the rest of `connectors/` (about 40), `dev/`, `lib/`,
  `field-test/`, `hub/`, `scripts/`, `schemas/`, `shared/`, `publish/`,
  `services/`, `google/`.
- **Why this needs to change.** The boxholder's decision covers every site,
  and the lint ban in Track 8 cannot land while any remain.
- **Direction.** Mechanical rewrites, reviewed per commit:
  `new Date().toISOString()` → `nowIso()`; `getBoxTime(r).toISOString()` →
  `getBoxTimeISO(r)`; `getBoxTime(r)` → `getBoxInstant(r)` with callers'
  types following; `Date.now()` → `nowMs()`; `Date.parse(x)` of untrusted
  text → `parseInstant(x)` (NaN guards become `null` checks), of own text →
  `Temporal.Instant.from(x).epochMilliseconds`; `a.getTime() - b.getTime()`
  sorts → `Temporal.Instant.compare` or epoch milliseconds; `fs.Stats` reads
  use `mtimeMs` (for example `core/chat/session/transcript-paths.ts:242,253`);
  `Last-Modified` in `webapp/routes/api/register/image.ts:43` →
  `httpDate(Temporal.Instant.fromEpochMilliseconds(stat.mtimeMs))`;
  `now: Date` parameters → `now: Temporal.Instant`. Git commit dates from the
  box clock use `Math.floor(instant.epochMilliseconds / 1000)`. Standalone
  scripts that start using Temporal import the installer first (Track 1).
  `schemas/capture-session.tsx:152-153` computes the duration from two
  instants; `time.duration` keeps writing `"4m2s"` with its local
  `formatDuration` (`:175-189`). Decision: the stored format does not change
  and no migration runs; see NOT in scope. Last commit: delete
  `getBoxTime`; update `beebox/AGENTS.md:221` (*"Use `getBoxTime`/
  `getBoxTimeISO` for timestamps"*), `docs/questions.md:183-184`,
  `docs/module-map.md:36`, `docs/event-bus.md:123` and
  `docs/box/publishing.md:416` (*`new Date().getFullYear()`* →
  `Temporal.Now.plainDateISO().year`).
- **Vocabulary lock-ins.** None beyond Track 2.
- **First implementation chunk.** `src/lib/` and `src/shared/` (30 and 15
  touched lines), since the rest imports them; then one commit per directory
  in the order above.

### Track 5 — Frontend sweep

- **What.** The 113 touched lines in `src/frontend/src`, plus
  `shared/relative-time.ts:35-37`.
- **Why this needs to change.** Same reason as Track 4; the frontend config
  carries its own copy of the ban.
- **Direction.** Timers and expiry use `nowMs()`; displayed dates use
  `boxNow()` (unchanged contract, `box-clock.ts:4-9`); `formatAgo` reads the
  year with `Temporal.Instant.fromEpochMilliseconds(…).toZonedDateTimeISO(
  Temporal.Now.timeZoneId()).year` and formats through `friendlyDate`.
  `deploy-page/poll.ts` runs without React or the polyfill
  (`eslint.config.ts:307-308`): `:40` becomes `new Intl.DateTimeFormat([],
  { hour: "numeric", minute: "2-digit" }).format(data.startedMs)` (Intl takes
  epoch milliseconds, no Temporal needed), and `:56` uses `parseHttpDate`.
  `parseHttpDate` must not touch `Temporal` (it returns epoch milliseconds
  through `Date.parse`, its one disable) so the deploy page needs no
  polyfill.
- **Vocabulary lock-ins.** None.
- **First implementation chunk.** `relative-time.ts`, `deploy-page/poll.ts`
  and `lib/*`, with their tests.

### Track 6 — Test-only sweep

- **What.** `Date` left in `beebox/test` and `src/frontend/test` after
  Tracks 2–5 (about 450 of the 798 touched lines).
- **Why this needs to change.** The boxholder decided the ban covers tests.
- **Direction.** Fixture instants are ISO strings or
  `Temporal.Instant.from("…Z")`; `BBX_TIME` values come from `isoTimestamp`;
  the two tests that assign `Date.now` (`test/hub/server.router.test.ts:787`,
  `src/frontend/test/…/catch-up.test.ts:112`) and one that assigns it at
  module level (`src/frontend/test/lib/chat-send-diagnostics.test.ts:43`)
  pass a clock argument instead where the code under test already takes one,
  or else keep the assignment with a line-level disable naming the clock the
  code reads. `mock.timers` with `apis: [..., "Date"]` names no `Date`
  identifier and stays.
- **Vocabulary lock-ins.** None.
- **First implementation chunk.** `test/core/` files that only build
  fixtures, then the rest by directory.

### Track 7 — workstreams-app, bin, schedules and Clerk

- **What.** The same move in the other packages.
- **Why this needs to change.** In the boxholder's scope.
- **Direction.**
  Both packages already import beebox source by relative path (for example
  `workstreams-app/src/router/server/auth.ts:20` *`import { assertNever }
  from "../../../../beebox/src/shared/invariant.js";`*,
  `workstreams-app/src/frontend/pages/RecentPage.tsx:7` imports
  `beebox/src/shared/relative-time.js`, and `bin/update-agent-sdk.ts` and
  `schedules/tour-check/run.ts` import from `beebox/src/`). So they reuse
  beebox's `src/shared/time.ts`, `src/lib/temporal-global.ts` and the
  frontend `ensureTemporal`: no second installer or time module.
  - `workstreams-app`: its server entry `src/server/main/backend.ts` and the
    router's process entry import the beebox installer first; its frontend
    boot awaits beebox's `ensureTemporal`; `"ESNext.Temporal"` in its
    tsconfigs; `.taprc` and the `test:router` script get the preload. 81 + 22
    touched lines (`server/main/quota-collect.ts`, `quota-parse.ts`,
    `frontend/lib/format.ts`).
  - Root `bin/` and `schedules/`: 82 shell shims run `node --import tsx
    <file>.ts`, and root `package.json` scripts do the same. Decision: each
    `bin/` or `schedules/` module that uses `Temporal` imports the beebox
    installer as its first line, instead of editing every shim; there is no
    single entry, and a module-level import cannot be bypassed by a new shim.
    Root `tsconfig.json:21` (*`"lib": ["ES2023"]`*) gains the Temporal lib.
    194 + 102 touched lines (`bin/smoke.ts`, `test-locks.ts`,
    `lib/schedules-*`, `schedules/*/run.ts`).
  - `beebox-clerk`: native Temporal, `minimum_chrome_version: "144"` in the
    manifest. `capture.ts:49` and `background.ts:82` use
    `Temporal.Now.instant().toString({ fractionalSecondDigits: 3 })`
    through a three-line local helper (Clerk mirrors beebox contracts by
    generation and imports no beebox source; `src/domain/commentary.ts:4`).
    `wxt.config.ts:10-15` runs in Node at build time; it imports
    `temporal-polyfill/global` (a new Clerk dev dependency, same pin) and
    reads `Temporal.Now.plainDateISO()`.
- **Vocabulary lock-ins.** None: the beebox installer and time module are reused.
- **First implementation chunk.** Clerk (smallest), then `workstreams-app`
  server, then its frontend, then `bin/` and `schedules/`.

### Track 8 — Lint ban and guidance

- **What.** Turn the ban on and write the rule down.
- **Why this needs to change.** Principle 11; without the ban the sweep
  decays.
- **Direction.** In `beebox/eslint.config.ts`,
  `src/frontend/eslint.config.ts`, `workstreams-app/eslint.config.ts`,
  `workstreams-app/eslint.frontend.config.ts`, root `eslint.config.ts` and
  `beebox-clerk/eslint.config.ts`, for sources and tests:
  `no-restricted-globals` `{ name: "Date", message: "Use Temporal: … see
  code-style.md Dates" }` and `@typescript-eslint/no-restricted-types`
  `{ types: { Date: … } }`. Also `no-restricted-properties` entries for
  `toISOString` and `toUTCString` (methods only `Date` has), to catch a
  `Date` that a library returns, which the identifier ban cannot see. Those
  entries go into every block that already sets `no-restricted-properties`
  for overlapping files, because a later block replaces the rule
  (`beebox/eslint.config.ts:348` *"Repeated because this block REPLACES the
  rule for these files"*). The rules go in each package config, not the
  shared preset, which other projects (`canvas-loop`, `site`, `browse`,
  `pub-worker`) also use. Expected line-level disables: about 10 in
  `src/shared/time.ts`, none in Clerk, and the test clocks
  from Track 6. Docs: a short "Dates" section in
  `beebox/code-style.md` (the helper list and the zone rule), the
  `frontend.md:153-156` paragraph reworded from "new code" to "all code",
  and one line in `bin/AGENTS.md` naming the installer import for `bin/` modules.
- **Vocabulary lock-ins.** The lint messages name the helpers.
- **First implementation chunk.** The beebox and frontend configs, with
  `pnpm lint` (full, since the change is broad) showing zero findings.

### Scenario walks

1. **A todo due "2026-08-14" in a box in America/Los_Angeles.** The card
   holds the string; YAML core schema keeps it a string. Server:
   `core/todo/query.ts:28-29` (*`now: getBoxTime(boxRoot)`*, *`timeZone: await
   boxTimeZoneOrHost(boxRoot)`*) becomes `getBoxInstant`; plate state
   compares `dayIn(now, "America/Los_Angeles")` with
   `parsePlainDate("2026-08-14")`. At `2026-08-15T06:30Z` (23:30 on the 14th
   in Los Angeles) today is the 14th, so the todo is not escalated, which is
   today's result through `localDay`. CLI: `bbx todos` prints `due=2026-08-14`
   (`src/cli/query-format.ts:29`, string pass-through) under the server's
   plate group. App: the chip reads `parsePlainDate(due).toLocaleString(locale,
   { month: "short", day: "numeric" })` = "Aug 14" in any browser zone;
   `calendarDay`'s UTC detour is gone. View: the view reads the field with
   `Temporal.PlainDate.from` per `views/doc/files.ts:207-212`; in Node,
   `bbx view check` has Temporal from the shared installer. Nothing is
   stored.
2. **A cron script across a DST change.** `cron: "0 9 * * *"`. `bbx tick`
   reads `getBoxInstant`; `isCronDue` passes `toLegacyDate(now)` to
   `CronExpressionParser.parse` and turns `prev().toDate()` into an instant;
   `lastRun` (`schedule/state.ts:83`, `z.string()`) is read with
   `Temporal.Instant.from` and written with `isoTimestamp`, same bytes. On a
   host in Los Angeles, cron-parser computes 09:00 local on both sides of
   2026-03-08 (17:00Z, then 16:00Z), as today; on the UTC production host it
   is 09:00Z both days, as today. The test sets `process.env.TZ` and checks
   `prev()` at 08:59 and 09:01 local on 2026-03-07, -08 and -09 against values
   recorded from the current code before the change.
3. **Simulated clock in a user-story test.** `journeys/phone-wait.ts:104`
   sets `BBX_TIME` from the target instant (now `isoTimestamp(at)`) for
   `bbx tick --script`; the child's `bootstrap.ts` installs the polyfill;
   `getBoxInstant` parses `BBX_TIME` strictly. The wait then writes
   `.beebox/clock-offset.json` (`:249`), whose `offsetMs` is a number, so
   `getBoxInstant` returns `fromEpochMilliseconds(nowMs() + offsetMs)` on a
   walk fixture. `simulated-clock.ts:15` formats that instant in the box zone
   for the agent's note. `journey-phone-wait.test.ts:88` builds its expected
   stamp from `nowMs() + offsetDays * day`. `.beebox/ran.log` lines and
   schedule state keep their format.
4. **A migration script spawned by the migration runner.** `bbx engine
   migrate` calls `runMigrationScript` (`core/migration-run.ts:113-118`),
   which spawns `node --import tsx --import
   <PACKAGE_ROOT>/src/lib/temporal-global.ts <script> <box> --apply`. The
   script's library calls (`getBoxTimeISO` for its commit, `parsePlainDate`)
   find `Temporal`. If the preload were missing, the first call throws
   `ReferenceError`, the script exits 1, and the runner treats it as a *"hard
   failure that stops the queue"* (`:107-109`): loud, not silent. Track 1's
   test covers it.
5. **A Google Calendar event with a TZID.** The API returns `start: {
   dateTime: "2026-11-01T01:30:00-07:00", timeZone: "America/Los_Angeles" }`
   (the first 01:30 of the fall-back night). `ics.ts` computes the wall time
   `2026-11-01T01:30:00` through `ZonedDateTime` and writes
   `DTSTART;TZID=America/Los_Angeles:20261101T013000` plus the generated
   VTIMEZONE. The file name uses `dateTime.slice(0, 10)` = `2026-11-01`,
   unchanged. Reading back, `ical.js` resolves the wall time with that
   VTIMEZONE and `toJSDate()` goes through `instantFromLegacyDate`. Which
   01:30 `ical.js` picks is today's behavior and does not change. `bbx
   calendar` then prints `Sun Nov 1  01:30-…` in the box zone; today the
   production host prints `08:30` (UTC).

## Could this be simpler?

The simplest version is the smallest fix above: Temporal at about 15
bug-class sites, `Date` everywhere else, and a lint rule against
`new Date(<string>)`. It fixes the five day-boundary bugs and the
hand-rolled offset code. It fails on the boxholder's decision (*"full updates
across the box"*) and on principle 8: two representations of an instant
would remain, and a reader of `now: Date` could not tell whether a day
boundary was computed correctly. A partial lint rule cannot separate a
date-only `new Date(text)` from a safe `new Date(ms)` without type
information, so the bug class would return.

Smaller parts that were cut:

- No `getBoxTime` twin after Track 4: one box clock.
- No proof that every entry installs the polyfill (no lint rule, no
  registry): a miss throws `ReferenceError` on first use.
- No `Temporal.Duration` for millisecond durations: nothing about them is
  wrong today.
- No change to stored formats, so no migration and no fixture churn.
- No new box guidance: the views doc already covers dates.

## Subplans

none

## Failure modes

> **Critical gap (accepted):** the identifier and type bans do not see a
> `Date` that a library returns (`stat.mtime`, `ical.js` `toJSDate()`,
> `cron-parser` `toDate()`). Code can call `getTime()` on it without naming
> `Date`. The `toISOString`/`toUTCString` property bans catch the common
> leftovers; `getTime` is too generic to ban. Accepted: the four libraries
> are wrapped in Track 3, and the residue is ordinary epoch arithmetic, not
> the date-only bug class.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A Node entry or spawned child misses the installer | Track 1 child tests for migration runner, box function, CLI | `ReferenceError: Temporal is not defined` on first use | Clear |
| `isoTimestamp` drops the fraction or emits nanoseconds, so stored strings change | Track 2 round-trip test against `toISOString` output | `fractionalSecondDigits: 3` | Clear (fixture diffs) |
| A malformed `BBX_TIME` or `stubs.yaml` time | `test/lib/time.test.ts` new case | Throws naming the variable | Clear (today: silent Invalid Date) |
| `parseInstant` rejects a zone-less timestamp that `Date.parse` accepted (git, tool output, hand-edited state) | Per-site tests in Track 4 | Caller reports `null` | Clear where the caller reports; each Track 4 site decides own-written (throw) vs untrusted (`null`) |
| `Temporal` value reaches `JSON`, tRPC, XState or `structuredClone` | Typecheck: wire types are `string`/`number`; no `z.date` | Convert at edges | Clear (`structuredClone` throws on a Temporal object) |
| Comparing instants with `<` | n/a | `valueOf` throws `TypeError` | Clear |
| Box-local day changes a visible date (husk name, prompt date, usage row, backup day, `bbx calendar`) | Per-site tests with a zone west of UTC at a time after 00:00Z | Intended fix | Clear; listed for the boxholder |
| VTIMEZONE output differs after the rewrite | Golden test of `generateVtimezone` for three zones | Same algorithm, Temporal offsets | Clear |
| `remind` accepts a skipped or repeated wall time | Gap and overlap tests | `disambiguation: "reject"` | Clear |
| Scheduler shifts a run time | Golden `isDue`/cron/`at` tests recorded before the change, with `process.env.TZ` set | Exact-semantics `parseScheduleDateTime`, host-zone cron | Clear |
| Polyfill and native Temporal disagree when Node gains it | None now | Installer skips the polyfill when native exists | Silent until tested; pin stays at 1.0.7 and a Node major bump runs the suite |
| Deploy page loads without Temporal and calls a helper that uses it | Deploy-page test | `parseHttpDate` returns epoch ms via `Date.parse` | Clear |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field.** ADDRESSED: a developer agent choosing between
  `nowMs` (wall clock) and `getBoxInstant` (box clock). The Track 8 lint
  messages and `code-style.md` name both; the sweep keeps each site's
  existing clock.
- **Stale ref.** Not applicable: no references change.
- **Two agents touching the same card.** Not applicable: no write paths
  change shape.
- **Hand-edit drift.** ADDRESSED: a hand-written zone-less `at` keeps today's
  meaning (`parseScheduleDateTime`); a hand-written `due: 2026-2-3` is
  refused by `parsePlainDate` as `parseIsoDate` refuses it today.
- **Fabricated free-form value.** Not applicable.
- **Validation error UX.** ADDRESSED: todo and schedule messages keep their
  wording; the `BBX_TIME` error names the variable and the bad value.
- **Partial migration / transition state.** ADDRESSED: within the branch,
  `getBoxTime` stays as a wrapper until Track 4 ends and the ban is off until
  Track 8; the plan ships only when all tracks are done. No stored data
  changes, so boxes see no transition.

## NOT in scope

- **Scheduler zone semantics** (cron `tz`, rrule `TZID`, zone-less `at` in
  the box zone): changes run times of existing cards; stays with
  `2026-10-27-schedules-ignore-the-box-timezone.md`.
- **`pub-worker`** (5 sites, all epoch-millisecond expiry math in
  `pub-worker/src/{access,deps,manifest-store}.ts`): not in the boxholder's
  list, a separate Cloudflare Workers runtime whose Temporal support is
  unverified, a size-sensitive bundle, and no calendar or zone logic to fix.
  It keeps its own lint config without the ban.
- **Capture-session `time.duration`** (`"4m2s"`, written by
  `schemas/capture-session.tsx:175-189`): stored format stays; normalizing it
  to `shared/relative-time.ts`'s format (`"4m 2s"`, `"1.2s"`) or ISO
  `PT4M2S` changes stored data and would need a migration for no reader's
  benefit.
- **Stored epochs in `.beebox/todo-review-sweep.json`**: stay numbers,
  converted at load and save.
- **Existing husk file names and calendar event file names**: not renamed.
- **`Temporal.Duration` for duration grammars** (`shared/iso-duration.ts`,
  `scheduled-script-duration.ts`): no `Date` involved; its 30-day month
  (`iso-duration.ts:43-47`) would change under `Duration.total`.
- **Accurate DST rules in the generated VTIMEZONE**
  (`ZonedDateTime.getTimeZoneTransition`): an improvement, not a `Date`
  replacement; output is kept byte-identical instead.
- **`performance.now()` for elapsed time**: one wall clock read (`nowMs`) is
  simpler; no measured problem with clock jumps.
- **Box-authored code** (box scripts, box views already in boxes): native
  `Date` stays available; guidance for views already exists. Scheduled
  `runs:` shell commands get no preload.
- **`ios-app/`**: Swift, no TypeScript date sites (census).
- **Node's `--harmony-temporal` flag**: experimental in V8.

## Open design questions

1. **Day-boundary fixes on production.** This plan moves five sites from UTC
   or host-zone days to box-local days (Track 3). Lean: yes; each is what a
   person reading the output expects, none changes stored meaning. The
   boxholder may prefer to keep `bbx usage` in UTC days.
2. **Order against the schedules-timezone issue.** After this plan, that
   issue is a few lines in `parseScheduleDateTime` and the two `cron-parser`
   calls. Lean: take it next, as its own change, with the boxholder told
   which production schedules move.

## Knowledge audits

Box guidance does not change (the views doc's "Dates" section shipped with
`box-view-guidance-and-checks.md`, with audit `view-date-only-temporal` in
`src/dev/knowledge-audits.yaml:9546`). Developer guidance changes at
`beebox/AGENTS.md:221` and in `code-style.md`. Add one dev audit (`surface:
dev`, `src/dev/knowledge-audits.yaml:8904` section): "In beebox server code,
how do you get the current time so a test's frozen box time applies, and how
do you store it?" `knows_directly`: `getBoxInstant` and `getBoxTimeISO` (or
`isoTimestamp`), and not `nowMs`. Run it with `pnpm knowledge-audit run
--dev --filter <id>` and record the status comment in Track 8.

## What will hold this after it ships

- **The lint ban** (Track 8) in every in-scope config, for sources and tests.
  It is the main hold.
- **Unit tests on `src/shared/time.ts`** pin the storage format and the
  parse policy. Cheap; pure functions.
- **Golden tests** recorded from the current code before each Track 3 change
  (scheduler `isDue`, VTIMEZONE, `remind` output) pin "no behavior change"
  where none is intended. They are ordinary unit tests; no new tier.
- **Child-process tests** (Track 1) pin the preload for the migration runner
  and box functions; the existing CLI child tests cover `bootstrap.ts`.
- No new test tier, no mock of Temporal, no tour.

## Implementation order

1. Track 1: installer, entries, preloads, `.taprc`, tsconfig `lib`,
   `render-one.ts`. One commit.
2. Track 2: time module and box clock (commit 1); box-local day, todo model,
   review state, `item-logic` (commit 2).
3. Track 3: `remind/time.ts`; then calendar (`ics`, `utils`, `notes`,
   `state`, `connector`, `cli/commands/calendar.ts`); then day sites (husk,
   phase, usage, backup, access log, session context); then the scheduler.
   Golden tests land in the commit before each change.
4. Track 4: `lib/` and `shared/`, then one commit per directory; last commit
   deletes `getBoxTime` and updates the five docs.
5. Track 5: frontend.
6. Track 6: test-only sweep.
7. Track 7: Clerk, `workstreams-app` server, its frontend, `bin/` and
   `schedules/`.
8. Track 8: lint configs, `code-style.md`, `frontend.md`, `bin/AGENTS.md`,
   the dev audit run.

Commit boundaries, not ship boundaries. The plan ships in one piece after
cross-model review, and only when the boxholder says so.

## Rollout shape

- **Tests first.** For each track, the tests named in its first chunk and in
  the Failure-modes table are written before the change: the time-module
  unit tests, the `BBX_TIME` rejection, the Track 1 child tests, and the
  golden tests for the scheduler, VTIMEZONE and `remind`. Done when every
  track's `pnpm test:changed` passes, the full `pnpm lint` in `beebox/`,
  `src/frontend/`, `workstreams-app/` and the root reports zero `Date`
  findings, and a full `pnpm test` run in the worktree passes once at the end
  (justified: the change reaches most of the suite).
- **Real runs against the test box clone**
  (`~/src/box-worktrees/web-guidance-scan/test1`): `bbx todos`, `bbx
  calendar` (with a box zone west of UTC), `bbx remind --at …`, `bbx tick
  --script <name>` with `BBX_TIME`, `bbx view check` on a stock view, and
  `bbx engine migrate` dry run. Compare outputs before and after; the only
  differences are the intended day-boundary fixes.
- **Knowledge audit:** the one dev audit, run in Track 8.
- **Migration:** none. No stored shape or meaning changes; the scheduler
  keeps its semantics; formats stay byte-identical.
