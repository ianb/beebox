---
title: "Plugins slice 3: connectors stay core"
status: implemented
workstream: plugins-planning
issues: []
---
# Plugins slice 3: connectors stay core

The plugins plan deferred "connectors as plugins" to a third slice. This plan
sizes three shapes of that slice against the code and recommends the
smallest: the connectors stay core. The three Google connectors are the
box's intake for mail, calendar and drive, intake is medium, and the plugin
mechanism (a library a box completes through stubs, nothing new at runtime)
does not fit code that runs at wakeup under shared credentials. The
deliverable is the boxholder's decision among the three shapes, recorded
where the next reader looks, plus the small finds the sizing turned up.

**Issues addressed:** none resolved. Related, found by grepping the queue for
`connector`, `plugin`, `telegram`:
[a calendar is a card with its events under it](../../../issues/closed/features/2026-10-10-a-calendar-is-a-card-with-its-events-under-it.md)
(not needed by this slice either way);
[connectors via Composio managed auth](../../../issues/features/2026-09-06-connectors-via-composio-managed-auth.md)
(auth stays core under every option here);
[plugins and the medium/content line](../../../issues/closed/exploration/2026-08-19-plugins-and-the-medium-content-line.md)
(closed; its framing decides this plan). Searched for a Telegram-removal
issue and a `Connector.produces` issue: neither exists; Track 2 files them.

## Design

No design section: under the recommended direction the person meets nothing
new. Under the fuller option (below) the one person-visible change would be
two activation steps where there is one today: the `googleServices` switch in
box settings, and a `plugins` entry with stubs. That doubling is an argument
against it, not a design to make.

## Smallest fix and budget

**Smallest fix:** change nothing in code; record "connectors stay core" in
`docs/plugins.md` and the design notes so the next planner does not re-derive
it. Estimated 40 changed lines of authored docs, no source.

**Chosen (shape A):** the smallest fix plus two issues the sizing found
(Track 2) and one dead field with its wrong generated docs (Track 3, about
20 source lines, 5 test lines). Total under 120 changed lines; docs and
issues reported separately: about 90 lines.

Two fuller shapes are sized here so the boxholder chooses with the numbers.
The boxholder's "go ahead and implement" came before this sizing; the
bbx-plan rule is that a BIG CHANGE needs approval at its measured size, so
shape C is a question, not a refusal.

**Shape B: declarative connector plugins, code stays put.** A
`src/plugins/gmail/plugin.ts` (and `google-calendar`, `google-drive`) with
`schemas: undefined` and a new declarative field, `connectors: ["gmail"]`:
connector names the engine resolves through the existing ordered registry
(`src/connectors.ts:37`). A plugin file cannot import the connector
(`plugin-imports`), so the hook is a name, and `bbx plugins list` resolves
it to `present` or `missing` as it does for views. Activation becomes the
one switch: `googleServices.<name>` (`src/core/box/config.ts:72`) retires,
`isGoogleServiceAllowed` (`:158`) reads the active plugin list, the admin
Google services toggles write `plugins`, a migration copies each `true`
toggle into a `plugins` entry on every box, and the `requirements.ts:56-62`
table follows, as do the other `googleServices` readers: `src/google/access.ts`,
`src/google/sync-skipped.ts`, `src/core/docs-gen/content.ts`,
`src/webapp/box-config-write.ts`, the admin router and `admin/google.ts`,
and the frontend's `GoogleServicesSection`, `AdminOverview` summaries and
Gmail filters display (twelve files by grep). What a person gets: one
listing of the connector plugins activated in this box, with each
connector's README beside it. Activated is not connected: whether Google
auth works and whether a sync ran stay where they are today, in the Google
and connector-activity health checks, so the listing adds a name, not a
state. What they lose: nothing; sync behaves as today. Cost: hook field and
resolution (about 60 lines), the policy switch retired and its twelve
readers and the admin writer reworked (about 200 lines), a migration with
plan and verify in the body-tags shape (about 150 source, 60 test), tests
for the policy change (about 90), three plugin directories with READMEs
(about 150 lines of docs), docs and skills that name `googleServices` (eight
files). About 500 source and 150 test lines, plus 200 of docs.

**Shape C: move the code.** Gmail, Google Calendar and Google Drive under
`src/plugins/<name>/` with a runtime `connectors` hook on `PluginDefinition`:

| Part | Lines today | What the move needs |
|---|---|---|
| Connector code (`src/connectors/gmail`, `google-calendar`, `google-drive`, every `.ts`) | 10,149 | moved; the 44 engine modules they import re-routed (see *What already exists*) |
| Core that imports connector internals: `bbx calendar`, `bbx connector`, `bbx drive`, tRPC `gmail`/`calendar`/`drive`/`admin.gmail` | 1,394 | stays core, so core imports plugin internals (inverts the boundary) or gains a commands hook and a routers hook that do not exist |
| Frontend: `renderers/{gsheet,gfolder,glink}.tsx`, `settings/CalendarSection.tsx`, `settings/DriveSection/*` (four files), `admin/GmailFiltersSection/*` (two files) | 1,487 | stays core, keyed by type names a plugin now owns, or a frontend registration path for plugins that does not exist |
| `src/google/*` (auth, tokens, gap, status, access, skip reasons) | 979 | stays core; exported to plugins |
| New `src/exports/` surface | 0 | the 44 engine modules the three connectors import today, re-exported |

The move is a git rename, cheap in itself; the work is the 44 re-routed
imports, the export surface and the two hook kinds that do not exist. Like
for like (additions plus deletions) the diff is over 20,000 lines; the
effort is the new public surface, which is a slice of its own. **BIG
CHANGE.** The sections below show it buys a person nothing that shape B does
not, and shape B's gain is a listing.

## Stated preferences this plan trades against

- **The medium/content line** (the boxholder, in the plugins issue): *"the
  basic medium shouldn't be a plugin, even when parts are obscure"* and
  *"Intake is medium — a box that cannot take material in is not a box."*
  (`issues/closed/exploration/2026-08-19-plugins-and-the-medium-content-line.md`).
  The line protects taking material in; it does not by itself say every
  source-specific integration is medium. The plan's claim is narrower: these
  three are the box's only intake for mail, calendar and drive, and what
  binds them to the medium is measured, not asserted: shared Google auth
  (`src/google/token-store.ts`, one refresh token across the three services
  and all boxes), the admin flow that connects it
  (`src/webapp/routes/admin.ts:11-13`), the scheduler alerts
  (`src/core/schedule/scheduler/google-auth-alert.ts:19`), the default
  schedules (`src/core/box/structure/defaults.ts:327-370`) and the 44 engine
  modules they import. The design notes' own list of what *"stays core as
  medium"* (`docs/implemented-plans/plugins-design-notes.md:193-197`) names
  intake types and the email and calendar base types; this plan extends it
  to the connectors that fill them, and sides with that over the candidate
  table at `:189-191`, written before the coupling was measured. A later
  source a box is *about* (a feed reader) is content and gets a plugin; the
  hook it needs is in NOT in scope until it exists.
- **Minimize invented concepts; prefer primitives** (boxholder feedback,
  recorded in session memory): *"two tiers of anything is a smell"*. A
  connector plugin adds a second activation beside `googleServices`
  (`src/core/box/config.ts:72`), or replaces that policy and reworks the
  admin UI that writes it (`src/webapp/trpc/routers/admin/router.ts:35-38`).
- **Principle 7, hierarchy is a discoverability contract**
  (`docs/engineering-principles.md:87`): the plugins plan chose the stub
  mechanism so that absence means non-existence
  (`docs/implemented-plans/plugins.md:592-595`). For a connector the
  discoverable fact is "is Google connected and allowed here", which
  `googleServices` and the Google health checks already say
  (`src/webapp/trpc/routers/health/checks/google.ts:14`); a plugin list
  entry would be a second place for the same fact.
- **`docs/plugins.md:79`**: *"The two hooks are the whole hook surface; add a
  new hook kind only with a real consumer and a plan."* The real consumer
  test fails here: the hook's only consumers would be code the engine ships
  and every box already runs.

## What already exists

- **The connector registry** `src/connectors.ts:37-48`:
  `defineRegistry<ConnectorFactory>({ directory: "./connectors", entry: "connector", ordered: true, members: { gmail, googleCalendar, telegram, googleDrive } })`.
  Order is semantics: *"a full wakeup runs connectors in this order"*
  (`src/connectors.ts:39-41`). Enumerated by `src/cli/commands/wakeup/connectors.ts:60`
  and `src/core/commands/connector-sync.ts:110`. Two call sites bypass it and
  build the four connectors by hand: `src/cli/commands/finalize.ts:69-72` and
  `src/cli/commands/drive/command.ts:82`. Reuse as is.
- **The plugin contract** `src/cards/plugin-definition.ts:47-65`: `name`,
  `description`, `docs`, `skill?`, `schemas`, `views?`, `healthChecks?`,
  `lintCards?`. No runtime hook of any kind; `docs/plugins.md:30-31`:
  *"Nothing new runs at runtime: a stub is an ordinary box schema, view or trick."*
- **The import boundary** `src/dev/layout/check/rules/plugin-imports.ts`:
  a plugin file imports only `src/exports/*`, `src/cards/plugin-definition.ts`,
  its own directory and packages. `src/exports/` holds `cards.ts`,
  `schema.ts`, `server.ts` (two server entry points) and `view-widgets.d.ts`.
  What the three connectors import from outside their directories today,
  deduplicated: git operations (`src/lib/git/core/operations.js`), card IO
  (`src/core/card-io.js`), the card and file locks, atomic write, content
  hash, paths, time, `src/transient-state.js`, box config
  (`isGoogleServiceAllowed`, `src/core/box/config.ts:158`), `src/google/auth.js`
  and `sync-skipped.js`, the three `src/services/google-*` services,
  `preserve-agent-fields.js`, the email and drive schemas, the command runner
  and trash command, job-card chat utils, box namespace and ref-path
  resolution, commit trailers, the field-test Gmail gate, and eight
  `src/shared/*` helpers: 45 distinct engine modules outside the three
  directories (relative imports resolved to paths and deduplicated across
  the 56 connector files), of which one (`src/exports/cards.js`) is allowed.
  The guide's rule for that case, `docs/plugins.md` *The import boundary*: a
  plugin that needs an engine internal means the engine is missing a public
  piece. Forty-four missing pieces is the engine.
- **Google policy and auth** stay core under every option: `googleServices`
  typed at `src/core/box/config.ts:72`, read by `isGoogleServiceAllowed`
  (`:158`), written by the admin router; tokens shared across the three
  services and across boxes (`src/google/token-store.ts`, header comment);
  the skip reasons `not-allowed` / `not-configured`
  (`src/google/sync-skipped.ts`, `src/connector.ts:55`).
- **Name-keyed core consumers** that would not follow a plugin: the default
  schedules `check-email`, `check-calendar`, `check-drive` with their pinned
  content hashes (`src/core/box/structure/defaults.ts:327-370, 452-454`);
  `GOOGLE_CONNECTORS` in `src/core/schedule/promotion.ts:33`; the
  requirements table `src/requirements.ts:56-62`; the box-growth connector
  roots (`src/core/box-growth/scan.ts:58-67`); the static connector docs
  table `src/core/docs-gen/content.ts:23-66`; the calendar, drive and email
  skills (`src/core/box/guidance-sync/skills/content.ts:13, 61, 102`).
- **Drive's four types are known to core** beyond the connector: search
  extraction (`src/core/search/extract/core.ts:98, 212, 276`),
  connector-owned markdown (`src/core/connector-owned-markdown.ts:61`), the
  frontend renderers (`src/frontend/src/renderers.ts:23-25, 71-73`) and
  `drive-card-display.ts:38`. Plugin schemas are bases a box completes
  through stubs; they do not join `cardSchemas` (`docs/plugins.md`, *Stubs*),
  so moving the four types means every Drive box writes four stubs and the
  search extractor needs a hook that does not exist.
- **Dead declaration, and a wrong one beside it.** `Connector.produces`
  (`src/connector.ts:17`) has no runtime reader in source, tests, the
  frontend or the wakeup JSON (`src/cli/wakeup-outcome.ts:45`); the only
  `.produces` outside `src/connectors/` is the hand-maintained static
  `ConnectorInfo` table in `src/core/docs-gen/content.ts:23-66`, which
  generates `box-docs/connectors.md` and is wrong on its own: Gmail says
  *"via IMAP"* (the connector uses the Gmail API through
  `src/services/google-gmail/core.js`), Drive lists `gsheet, gdoc` and omits
  `gfolder` and `glink`, Telegram says `telegram-message` where the
  connector writes `chat-thread` for incoming messages and only sends
  `telegram-message` cards (`src/connectors/telegram/connector.ts:77, 143`).
  Calendar's class value `produces = ["calendar-event"]`
  (`src/connectors/google-calendar/connector.ts:72`) names a type with no
  schema. Track 3 covers both.

## Prior art (external)

No decision here depends on an external premise: the question is where code
lives inside this repository, settled by the repository's own line. No
search made.

## Ontology

No new nouns. The plan uses the codebase's names: **connector**
(`src/connector.ts:13`, a `name`, `inboxPaths`, `sync()`), **plugin**
(`src/cards/plugin-definition.ts:47`), **stub** (`docs/plugins.md`, *Stubs*),
**Google service policy** (`googleServices`, `src/core/box/config.ts:72`),
**medium** and **content** (the plugins issue). Removing `produces` removes a
field, not a noun: nothing read it.

## Tracks / scope

### Track 1: record the decision

**What.** `docs/plugins.md` gets a short *What stays core* paragraph naming
the connectors and the reason, next to its hook-surface sentence (`:79`).
`docs/implemented-plans/plugins-design-notes.md` keeps its candidate table
as history and gains one dated line under *Candidates* pointing here. The
agent-facing connector docs do not change: nothing an agent does changes.

**Why this needs to change.** Two implemented plans say slice 3 is coming
(`plugins.md:611, 688`; design notes `:189-191`). A planner reading them
would redo this sizing.

**Direction.** Prose only, in the two files named. Implemented plans are
history and are not rewritten; the pointer goes in the design notes, whose
*Open* section is where the slice was left.

**Vocabulary lock-ins.** None.

**First chunk.** The two edits and this plan moved to `implemented-plans/`
with status `implemented`. One commit.

### Track 2: file the two issues the sizing found

**What.** (a) Telegram removal: the design notes call for *"its own issue"*
(`plugins-design-notes.md:203`) and none exists. (b) `Connector.produces` is
declared and never read, and Calendar's value names a type that does not
exist; Track 3 fixes it, so this issue is filed only if Track 3 is cut.

**Why.** The design notes' promise is unkept, and a dead field misleads the
next connector author into declaring types the engine never checks.

**Direction.** `issues/features/<date>-remove-the-telegram-connector-and-chat-channel.md`
with `workstream: unattached`, listing what Telegram touches
(`src/connectors/telegram/`, the admin router import at
`src/webapp/trpc/routers/admin/router.ts:7-8`, the `telegram` skill if one
exists, `docs/connectors/telegram.md`, the three Telegram doctests) and the
person-facing consequence: a box that uses Telegram loses it, so the issue
needs the boxholder's word on whether any does before it is `do-it`.

**First chunk.** The issue file. Same commit as Track 1.

### Track 3: delete `Connector.produces` and correct the generated connector docs

**What.** Remove `produces` from `Connector` (`src/connector.ts:17`) and from
the four connectors (`gmail/connector.ts:141`, `google-calendar/connector.ts:72`,
`google-drive/connector.ts:54, 65`, `telegram/connector.ts:77`), plus any
doctest line that prints it. Correct the static table in
`src/core/docs-gen/content.ts:23-66` against each connector's header
comment: Gmail reads through the Gmail API, not IMAP; Drive produces `gdoc`,
`gsheet`, `gfolder`, `glink`; Telegram produces `chat-thread` cards for
incoming messages and sends the agent's `telegram-message` cards from
`_bookkeeping/output/` (`src/connectors/telegram/connector.ts:77, 143`), so
its line keeps both. Regenerate `box-docs/connectors.md`.

**Why.** A field with no reader is a promise the engine does not keep
(principle 4, never silent: a wrong value here is invisible). Calendar's
`calendar-event` proves it: declared since the connector was written, and
nothing noticed. The generated docs are the agent-facing claim, and they are
wrong today in three places the type checker cannot see.

**Direction.** Delete the field; `getAllDriveHandlers` keeps its other caller
(`google-drive/tracking.ts:122`). `pnpm typecheck` finds every reader, which
is the test that the field is dead. The docs table stays hand-maintained
(it is prose about each connector, not a mirror of a runtime field); its
`produces` list is checked by eye against `src/schemas.ts:116-127`, where
the synced card types are registered.

**First chunk.** The deletion, the table correction, the regenerated box doc,
and `test/cli/commands/wakeup/connectors.doctest.md` if its fake connector
carries the field. One commit.

## Could this be simpler?

The simplest version is Track 1 alone: forty lines of docs. Tracks 2 and 3
add two issue files and a ten-line deletion that the sizing surfaced; they are
in-scope finds this workstream owns, and leaving them means the next person
who reads `src/connector.ts` trusts a field nothing reads. The fuller
alternative is the move itself, sized above; it fails the gate, because the
one thing it buys, a smaller `src/connectors/` directory, is not a thing a
person using a box ever meets, and the plan cannot name a principle it
serves that the connectors' current home does not.

## Subplans

none

## Failure modes

The chosen tracks add no codepath. One deletion:

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A reader of `produces` exists that the grep missed | typecheck fails on the deletion | n/a | clear: compile error names the file |
| A doctest prints a connector object and the snapshot still shows `produces` | that doctest | n/a | clear: the doctest fails |
| The corrected docs table drifts again when a connector gains a type | none: the table is hand-maintained prose | none | silent, as today; accepted: the table is the connector docs' summary line, and the card docs it links are generated from the schemas |

No critical gap; the docs-table drift is accepted above with its reason.

## Agent-flow / user-flow edge cases

- Wrong tag / wrong field: n/a, no new field or tag.
- Stale ref: n/a.
- Two agents touching the same card: n/a.
- Hand-edit drift: n/a.
- Fabricated free-form value: n/a.
- Validation error UX: n/a.
- Partial migration / transition state: n/a, no data shape changes. ADDRESSED
  by having nothing to migrate.

## NOT in scope

- **Moving any connector into a plugin.** Sized above; declined on the
  medium/content line. A future plugin that is itself a source (a feed
  reader a box is *about*) is a new case with its own plan; it would need the
  `connectors` hook the design notes named, and this plan leaves that hook
  unbuilt until that consumer exists (`docs/plugins.md:79`).
- **Removing Telegram.** Track 2 files it; a box may depend on it, so it is
  the boxholder's call.
- **A calendar card.** Filed separately on 2026-10-10; orthogonal to where
  the connector lives.
- **The two hand-built connector lists** in `finalize.ts:69-72` and
  `drive/command.ts:82`. A small `one way` (principle 8) cleanup, but not a
  defect: both lists are complete today. Noted here so it is not re-found.
- **Drive's four types as a plugin on their own.** They are owned by the
  connector that writes them and known to search and the frontend; moving
  the types without the connector splits an owner in two.

## Open design questions

- **Which shape: A, B or C.** The boxholder's call; this plan is written for
  A. Lean: A. Shape B's gain is one list of what is on in a box, bought with
  a box.json migration across every box and an admin UI rework; shape C's
  gain over B is a smaller `src/connectors/` directory, bought with the
  largest change in the repository's history. If B, this plan's tracks
  become its first chunk and a Track 4 (hook, policy switch, migration)
  follows with its own design section, since the admin toggles change. If
  C, this plan is superseded by one that first builds the public server
  surface, which is its own slice.

## Knowledge audits

Skip: nothing agent-facing changes. The connector docs, skills and the
`--connector` names an agent uses stay as they are.

## What will hold this after it ships

Track 1 is prose; `pnpm doc-check` holds its links. Track 3's deletion is
held by the type checker: a future reader of `produces` cannot compile. Its
docs-table correction is held by nothing but the next reader; see Failure
modes. The decision
itself is held by `docs/plugins.md`, which `test/plugins.doctest.md` does not
read, and by this plan under `implemented-plans/`.

## Implementation order

1. Track 1 docs and Track 2 issues, one commit.
2. Track 3 deletion, one commit, after `pnpm typecheck` and the changed
   doctests pass.
3. Move this plan to `implemented-plans/` with status `implemented`.

## Rollout shape

No tests to write first: Track 3's test is the compiler. Done when
`pnpm typecheck`, `pnpm lint`, `pnpm layout-check` and `pnpm test:changed`
pass and `pnpm doc-check` accepts the two doc edits. No migration, no
knowledge audits, no data changes.
