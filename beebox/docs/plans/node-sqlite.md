---
title: "Replace better-sqlite3 with node:sqlite"
status: draft
workstream: dep-reduction
issues:
  - ../../../issues/code-quality/2026-10-27-better-sqlite3-install-prints-dep0176-on-deploy.md
  - ../../../issues/code-quality/2026-10-25-dependency-reduction-sweep.md
---
# Replace better-sqlite3 with node:sqlite

beebox keeps two SQLite databases per box: the event bus (`.beebox/events.db`)
and usage accounting. Both use `better-sqlite3`, a native module. Node 24 ships
`node:sqlite` with no native build. This plan moves both databases to
`node:sqlite` behind one small module, and removes the native-module
machinery that existed only for `better-sqlite3`.

The boxholder decided this on 2026-10-27, after comparing the two ("plan and
make the change to node:sqlite"). They also asked that a later move to Bun
stay possible.

## Design

No design section: no person sees a difference. The databases, their files,
and their contents stay the same.

## Smallest fix and budget

The smallest change edits the two files in place, calling `node:sqlite`
directly. Each file would then need its own transaction wrapper, busy timeout,
and row validation. The chosen change puts those in one module,
`beebox/src/core/sqlite.ts`, which both files use. The module is also the one
place a `bun:sqlite` version would replace (see *Prior art*).

Estimate, additions plus deletions:

- `beebox/src/core/sqlite.ts`: about 80 new lines.
- `usage.ts` and `event-bus/core.ts`: about 60 changed lines.
- Tests: about 40 changed lines in `beebox/test/core/event-bus.test.ts`, and
  about 60 new lines for the new module.
- Removals: the doctor native-module check, its test fixture and dependency
  type (about 50 lines); the deploy ABI guard (about 12 lines); build-script
  allow-list entries in four files; and the dependency in root and beebox
  `package.json`.
- Docs: about 10 lines.

The total is about 400 changed lines. This is not a BIG CHANGE.

## Stated preferences this plan trades against

- **Bias toward strict.** better-sqlite3's typed `prepare<P, R>()` generics are
  unchecked casts. `node:sqlite` returns `Record<string, SQLOutputValue>`. The
  plan validates rows with zod at the module boundary, so an unexpected
  column shape fails loudly. This costs a parse per row on the event bus
  read paths. `readSince` has no `LIMIT` (`core.ts:337-339`), so a reconnect
  can read a whole backlog. Measured on Node 24.18.0: zod parses 50,000
  event-shaped rows in about 7 ms.
- **Operational simplicity.** The change removes a compiled module, its
  install script, the deploy ABI guard, and the doctor ABI check. Nothing
  new is installed.
- **Minimize invented concepts.** The new module is a thin wrapper, not a
  query layer. It adds `transaction()`, the open options, and typed
  `get`/`all`. It adds nothing else.

## What already exists

- Event bus open: `beebox/src/core/event-bus/core.ts:307`:
  *"const db = new Database(dbPath);"* then `:308` *"db.pragma("journal_mode = WAL");"*.
- Read-only open: `event-bus/core.ts:83`:
  *"const db = new Database(dbPath, { readonly: true, fileMustExist: true });"*.
  `:82` checks *"if (!fs.existsSync(dbPath)) return;"* first.
- Transactions: `event-bus/core.ts:164` *"const reconcile = db.transaction(() => {"*;
  `usage.ts:290` *"const txn = db.transaction(() => {"*; `usage.ts:341`
  *"db.transaction(() => {"*. All three are synchronous.
- Write results: `event-bus/core.ts:376`
  *"const id = Number(result.lastInsertRowid);"*; `:453` *"return result.changes;"*;
  `:174` *"db.prepare("DELETE FROM events").run().changes"*.
- Arbitrary SQL: `usage.ts:368-375`, `queryUsage(boxRoot, sql)`, runs
  *"const stmt = db.prepare(sql); return stmt.all();"*. Its callers are
  `beebox/src/cli/commands/usage.ts:67` (user-supplied `--sql`) and `:91`.
- Doctor probe: `bin/doctor-lib.ts:106-113`, `loadBetterSqlite3`, documented
  as *"THE check that catches Node-ABI drift directly"*; check at
  `bin/doctor-checks.ts:152`.
- Deploy guard: `beebox/deploy/deploy.sh:733-745`, *"Native-module ABI guard"*,
  which rebuilds better-sqlite3 when `require("better-sqlite3")` fails.
- Build-script allow lists: `BOX_BUILT_DEPENDENCIES` in
  `beebox/src/core/box/package.ts:52`, `beebox/docker/Dockerfile:219`,
  `beebox/docker/entrypoint.sh`, `pnpm-workspace.yaml:4`.
- Tests that open the DB directly: `beebox/test/core/event-bus.test.ts:18`
  *"import Database from "better-sqlite3";"*, used at `:168`, `:213`, `:241`,
  `:258`.
- Node pin: root `package.json:75` *"node": ">=24.11.0 <25"*. `node:sqlite`
  is in every Node 24 release. On this machine (Node 24.18.0) it reports
  SQLite 3.53.1 and prints no experimental warning.

Searched the issue queue for `node:sqlite` and `better-sqlite3` beyond the
inventory: only the DEP0176 deploy-warning issue matches.

## Prior art (external)

Verified 2026-10-27:

- **better-sqlite3 defaults that must carry over.** Its `Database` opens with
  a 5000 ms busy timeout. `node:sqlite` `DatabaseSync` defaults to `timeout: 0`,
  which fails at once with `SQLITE_BUSY`. The event bus is opened by several
  processes (`core.ts:298`: *"emitted by external processes (CLI, background
  agents)"*), so the module sets `timeout: 5000`.
- **`node:sqlite` differences:** there is no `pragma()` (use `exec`) and no
  `transaction()`. `readOnly` replaces `readonly`. `changes` and
  `lastInsertRowid` are `number | bigint`. `get()` returns `undefined` when
  there are no rows. `StatementSync.all()` on a statement that returns no
  columns runs it and returns `[]`. better-sqlite3 throws there (*"This
  statement does not return data"*).
- **Bun.** Bun does not implement `node:sqlite`. Its reference page says:
  *"Not implemented. Consider using `bun:sqlite`"*
  (bun.com/reference/node/sqlite). `bun:sqlite` (bun.com/docs/runtime/sqlite)
  is modeled on better-sqlite3. It provides `new Database(path, { readonly, create })`,
  `prepare`/`query`, `get` (returns `null` on no row), `all`, and `run`
  (returns `{ changes, lastInsertRowid }`). It also has a `transaction(fn)`
  helper that is deferred by default, and runs PRAGMAs through `run`/`exec`.
  Every call the new module exposes maps onto `bun:sqlite`, with two
  adaptations a Bun port must make: Bun's `Database` has no `timeout` option,
  so it runs `PRAGMA busy_timeout = 5000`; and Bun's default `close()` lets
  live statements hold the connection open, so it calls `close(true)`.
  `StatementSync.columns()` maps to Bun's `Statement.columnNames`. A Bun port
  changes only `sqlite.ts`; `sqlite.ts` records these notes.

## Ontology

- **`SqliteDb`**: the module's handle. It has `exec(sql)`, `prepare(sql)`,
  `transaction(fn)`, and `close()`.
- **`SqliteStatement`**: it has `run(...params)`, which returns
  `{ changes: number; lastInsertRowid: number }`. It also has
  `get(schema, ...params)` and `all(schema, ...params)`, which validate rows
  with a zod schema, and `allUnchecked()` for `queryUsage`'s user-chosen
  columns. `allUnchecked()` throws before it runs a statement that returns no
  columns (`StatementSync.columns()` is empty), as better-sqlite3's `.all()`
  did.
- **`transaction(fn, { immediate? })`**: deferred by default, as
  better-sqlite3 and `bun:sqlite` use. `immediate` begins with
  `BEGIN IMMEDIATE`.
- **`openSqlite(path, { readOnly? })`**: it opens with `timeout: 5000`. A
  writable open also sets WAL mode. It does not create a missing file when
  `readOnly` is set.

These names are new. No other module uses them, and the code has no other
SQLite abstraction (searched `beebox/src` for `DatabaseSync` and `sqlite`:
only the two databases).

## Tracks / scope

One track. The steps:

1. Add `beebox/src/core/sqlite.ts` and its test,
   `beebox/test/core/sqlite.test.ts`. The test covers the busy timeout
   option, transaction commit and rollback, read-only refusal, row
   validation failure, and `changes`/`lastInsertRowid` as numbers.
2. Port `event-bus/core.ts`. Statements use `get(schema)`/`all(schema)` with
   zod row schemas. `reconcileSchemaGeneration` uses
   `db.transaction(fn, { immediate: true })`. Today it is deferred: two
   processes opening a stale DB can both read the old generation, and the
   second write then fails with `SQLITE_BUSY_SNAPSHOT`, which the busy
   timeout does not cure (cross-model plan review; sqlite.org/isolation.html).
   `BEGIN IMMEDIATE` waits on the write lock instead.
   `beebox/test/core/sqlite.test.ts` shows a second connection cannot take
   the write lock inside an immediate transaction, and can inside a deferred
   one.
3. Port `usage.ts`. `queryUsage` runs `PRAGMA query_only = ON` before the
   user's SQL and reads through `allUnchecked()`. A write fails, and a
   statement with no result columns (for example `ATTACH`) fails before it
   runs, as both did before. Tests cover `DELETE` and `ATTACH`.
4. Port `beebox/test/core/event-bus.test.ts` to open its raw handles through
   `node:sqlite`.
5. Remove the doctor native-module check (`checkNativeSqlite`,
   `loadBetterSqlite3`, its test fixture, and the doctor header line). The
   deploy ABI guard goes too. Nothing else in the server runtime is a
   Node-ABI addon. `sharp` is a runtime dependency (`beebox/package.json:184`,
   loaded by `src/webapp/routes/api/register/images.ts:46-49`), but it uses
   Node-API, which is stable across Node majors. `esbuild` is a standalone
   binary.
6. Remove `better-sqlite3` from the root and beebox `package.json` and from
   the four allow lists. Run `pnpm install`.
7. Update the current docs: `beebox/docs/development/technologies.md:15`,
   the `bundle.ts:8` comment, and the Dockerfile comment at `:207`. Keep
   dated history, such as `health-checks.md` and the `health.ts` incident
   notes, as written.

## Could this be simpler?

The simplest version calls `node:sqlite` directly in both files, with no
module. It would copy the transaction wrapper and the busy timeout into each
file, and it would need casts or inline zod parsing at every `get`. The
module is the same code once, and it makes a Bun port a one-file change,
which the boxholder asked to keep possible. A query builder or ORM is
unnecessary for six statements.

## Subplans

None. One track.

## Failure modes

- **Busy timeout lost.** Without `timeout: 5000`, a CLI emit that races the
  hub's write would throw `SQLITE_BUSY` at once. The module sets it, and its
  test checks the option reaches the handle (`PRAGMA busy_timeout` reads
  5000).
- **Row shape drift.** A renamed column would have read as `undefined`
  through a cast. Now it throws a zod error naming the column.
- **Bigint results.** `node:sqlite` returns `number` for integers in the
  safe range, and throws `ERR_OUT_OF_RANGE` beyond it. Event ids and token
  counts stay far below 2^53.
- **Write SQL through `queryUsage`.** This is covered by `query_only` (step
  3), and a test runs a `DELETE` through `queryUsage` and expects an error.
- **Existing database files.** The on-disk format and WAL are SQLite's
  own, the same for both bindings. The SQLite version changes (Node bundles
  3.53.1). That reads older files, and nothing here uses newer-format
  features.
- **Box installs.** Package-layout boxes and the Docker image install beebox
  as a dependency. After this change their reinstall drops better-sqlite3.
  The four allow lists change together. No script compares them
  (`smoke-docker.sh` builds and probes HTTP only), so the implementation
  greps all four for `better-sqlite3` before commit.
- **Node experimental status.** `node:sqlite` is a release candidate in Node
  24. An API change would surface in `sqlite.ts` and its test on the Node
  bump that brings it. The `<25` engines pin already makes that bump
  deliberate.

## Agent-flow / user-flow edge cases

- A box agent runs `bbx usage --sql "SELECT ..."`. The command syncs, then
  prints an aligned table. Walked: `cli/commands/usage.ts:67` →
  `queryUsage` → `allUnchecked()`. `node:sqlite` rows are null-prototype
  objects with the same keys and values.
- A box agent runs `bbx usage query --sql "DELETE FROM usage"`. Before, it
  failed with *"This statement does not return data"*. After, it fails with
  *"attempt to write a readonly database"*. Both are errors, and the data
  stays.
- An older engine opens an events.db that a newer engine wrote. The
  `assertEventSchemaNotNewer` path is unchanged except for the open call.
  Its existing test (`event-bus.test.ts:258`) covers it.

## NOT in scope

- Moving to Bun, or adding a `bun:sqlite` implementation now.
- The Docker build stage's `python3 make g++` toolchain
  (`Dockerfile:21-25`). It may no longer be needed, but other packages
  might still compile. This needs its own check in an image build.
- The `bin/lib/skill-usage-patterns.ts:57` ABI error pattern. It classifies
  historical transcripts, so it stays.
- Any schema or query change.

## Open design questions

None. The busy timeout value, the transaction modes, and the
`queryUsage` guards are set above.

## Knowledge audits

None needed. No agent guidance names better-sqlite3. Searched
`beebox/src/core/agent-guide/` and `beebox/box-docs`: no matches.

## What will hold this after it ships

- `beebox/test/core/sqlite.test.ts` covers the module's contract.
- The event bus and usage tests cover behavior through the module.
- Nothing checks the four allow lists against each other. That gap
  predates this plan; the `package.ts` comment that claims
  `smoke-docker.sh` checks it is corrected in step 7.

## Implementation order

The steps in *Tracks / scope*, in order. Each step typechecks before the
next. After step 6: `pnpm install`, then typecheck, lint, the
change-selected beebox tests, and the doctor tests.

## Rollout shape

It lands as one merge and deploys. The deploy's dependency reinstall removes
better-sqlite3 from the server, and each package-layout box's reinstall
removes it there. No data migration is needed.
