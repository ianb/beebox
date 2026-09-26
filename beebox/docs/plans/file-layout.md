---
title: "Source file layout: principles, rules, and what a check can verify"
status: draft
workstream: file-layout
issues:
  - ../../../issues/code-quality/2026-09-26-source-file-layout-review-and-enforcement.md
---
# Source file layout: principles, rules, and what a check can verify

Large flat directories in `beebox/src`, `beebox/test`, `bin/`, and
`workstreams-app/` keep growing because nothing says when a directory is full
or what a new file's neighbours must be. This plan states the principles a
layout must satisfy, the rules that follow from them, and for each rule what a
check can verify mechanically. It covers steps 1 and 2 of the anchor issue.
The check design (step 3) and the moves (step 4) are later work; this plan
gives them their definitions. It does not produce a target tree or a move
list.

**Issues addressed:**
[source file layout review and enforcement](../../../issues/code-quality/2026-09-26-source-file-layout-review-and-enforcement.md).
Related, referenced not duplicated:
[structured module docs and code search](../../../issues/features/2026-08-12-structured-module-docs-and-code-search.md)
(may reuse the same module boundaries).

## Smallest fix and budget

Smallest fix: add "a subject with more than two files gets a directory" to
`code-style.md` and apply it when a file is next touched. That changes nothing
now, and the existing clusters stay. It also fails engineering principle 7: a
contract that is never checked is not a contract.

Chosen design: this document, then a check, then one move window.

| Step | This plan | Later |
|---|---|---|
| Rules and principles | ~350 authored doc lines (this file) | |
| Anchor issue update | ~30 lines | |
| Check (`beebox/src/dev/`) | | est. 400 source + 150 test lines |
| Moves | | thousands of changed import lines; git history preserved by `git mv` |

The move is a BIG CHANGE by line count and needs its own approval and its own
window. Nothing in this plan moves a file.

## Stated preferences this plan trades against

- Engineering principle 7, *hierarchy is a discoverability contract*
  (`docs/engineering-principles.md:87-93`): *"a cluster that encodes its
  directory in filename prefixes (`chat-session-*.ts` × 15 in a flat
  directory)"* breaks it. The principle already names the failure; this plan
  supplies the rule and the measure.
- Engineering principle 8, *one way to do each thing*: one registry style,
  one test-placement rule, one meaning for a directory name.
- `code-style.md`, file naming: *"A file that moves into a subdirectory drops
  the now-redundant directory prefix from its name."* Kept and made a rule.
- `code-style.md`, no barrels (boxholder decision, 2026-07-12). Kept and
  extended to a ban on the `index.ts` name (rule 6).
- `docs/module-map.md`: the four shared-code directories and their dependency
  direction. Kept unchanged. This plan adds rules for the subject directories
  the module map does not cover.
- The sibling doc-structure plan
  (`docs/implemented-plans/doc-structure.md`, principles 1 to 9). Four of its
  principles carry over to source directories: siblings partition the parent
  on one axis, names are the search path, a thing lives at the lowest node
  whose scope contains all its uses, and the parent holds only what is true
  of the whole. One does not: source directories get no index page (see
  *Could this be simpler?*).
- Boxholder rulings in the discussion that opened this workstream: a flat
  directory is valid only when every file is exactly one member of one kind;
  a filename-prefix heuristic is not the basis for a rule; registries are
  worth formalizing; `index.ts` may be banned; a single-file directory is a
  problem; tests need a convention. Later the same day: the result must be
  clean with no exceptions ("generalize the rules until they are correct");
  contract names for member entries are fine; the two-file unit threshold is
  not a concern; the minimum-two-children rule is dropped.
- Memory: *minimize invented concepts, prefer primitives* (directories, file
  names, imports, and the existing registries are the primitives; no new
  metadata or manifest) and *bias toward strict*.

Trade-off accepted: the rules produce many small directories where the tree
now has prefix pairs (`tick.ts` beside `tick-helpers.ts`). The reason is in
rule 3: the second file is the cheapest moment to make the directory, and
every 25-file prefix cluster in the tree started as a pair.

## What already exists

- Three set registries with the same shape, an explicit typed list in the
  parent of the set directory:
  `src/cli/surface-commands.ts:145` `VERB_COMMANDS`, keyed *"off each
  command's own `name()` rather than by a hand-written name → export mapping"*
  (line 4); `src/webapp/trpc/router.ts:43` `appRouter = router({...})` beside
  `routers/`. Both list entry modules only; the helpers beside those entries
  are what rule 1 flags. Reuse this shape as the rule.
- A registry by path: `src/core/migrations.ts:51` `MIGRATIONS` is a typed list
  of `{ name, script }` pairs naming files under `scripts/migrate/`, loaded at
  run time. The set directory is `scripts/migrate/`, in a different package
  root; `src/core/migrations/` (one file) is unrelated to it. The completeness
  check in rule 4 applies to a path registry the same way.
- One registry inside its set: `src/schemas/registry.ts:90` `cardSchemas`.
  Same idea, wrong place (rule 4).
- Two side-effect registries. `src/connectors/index.ts:100`
  `registerConnector`, called at module scope in six connector files
  (`gmail.ts:323`, `google-drive.ts:260`, `google-calendar.ts:314`,
  `telegram.ts:391`, `push.ts:85`, `publish-submissions.ts:278`); a
  connector exists only if something imported its module.
  `src/frontend/src/renderers/index.ts:17` re-exports `registerFileType`
  and is also a barrel. Both are replaced by explicit lists (rule 4).
- A plural-named directory that is not a set: `src/services/` holds client
  subsystems (`claude-chat-*`, `codex-*`, `cloudflare-*`, `tailscale-*`) and
  `services/index.ts` is a container type, not a registry. Rule 1 finds
  sets by their registry declaration, never by the name.
- A two-way registry cross-check already in the tree:
  `src/cli/surface-commands.ts:6-9`: *"`surface-build.ts` fails loudly when the
  surface table names a verb that is absent here, and
  `test/cli/surface.doctest.md` fails when a verb here is absent from the
  table"*. The completeness check in rule 4 is this pattern applied to the
  directory instead of a table.
- `pnpm lint:knip` reports a project file no entry reaches. An unregistered
  member is already visible there, but knip is a periodic sweep, not a gate
  (`code-style.md`, "Only export what's needed").
- `pnpm lint:circular` (madge) and the import-boundary lint rules in
  `eslint.config.ts` (`*.list-entry.tsx` may import backend as types only,
  line 150; box-tmp rule, line 207) already read the import graph. The layout
  check reads the same graph.
- `bin/test-graph.ts` builds the import graph for change-based test
  selection. Test selection does not depend on the test tree mirroring the
  source tree, so tests can move without breaking it.
- `docs/testing/doctests.md:20`: *"Create `test/<area>/<name>.doctest.md`
  mirroring the source path."* The only written test-placement rule. It says
  "path" and the tree applies it as "top-level area".
- Per-directory instruction files: `src/connectors/CLAUDE.md`,
  `src/services/CLAUDE.md`, `src/hub/CLAUDE.md`, `src/dev/CLAUDE.md`,
  `src/core/reactor/CLAUDE.md`, `src/frontend/src/components/chat/CLAUDE.md`,
  each with a generated `AGENTS.md`. These are the source-tree analogue of a
  parent page and are where a directory states its axis (rule 7).
- `beebox/CLAUDE.md:45`: box code *"imports only public
  `beebox/{cards,schema,view-widgets}` specifiers, never engine internals"*.
  Moves inside the engine do not reach boxes.

## Prior art (external)

The registry decision (rule 4) depends on the trade-offs among enumeration
techniques. Four are in common use; each is named here with what it buys and
what it costs, so the choice is explicit.

- **Explicit list module.** A hand-maintained array or record that imports
  each member. What Express, Fastify, tRPC, Commander, and Zod-based CLIs do
  by default; what this repo does in three of four registries. Buys: static
  imports (typecheck, knip, madge, bundlers, test selection all see the
  edges), one greppable place, tree-shaking, deterministic order. Costs: a
  forgotten entry is a silent absence. The cost is removed by a
  completeness check, which is one `readdir` compared with one import list.
- **Convention discovery (glob or directory scan).** Vite's
  `import.meta.glob`, Next.js and SvelteKit file-system routing, Rails
  Zeitwerk autoloading, Storybook's stories glob, the Python `pkgutil` plugin
  idiom. Buys: no list to maintain. Costs: the edge is invisible to static
  tools (knip reports every member unused, madge and test selection miss
  them), load order is filesystem order, no type-level exhaustiveness, and a
  bundler-specific primitive in engine code. This repo already uses a
  directory scan where the members are unknown at build time:
  `src/schemas/registry.ts:10` reads a box's own schema directory at runtime.
  That is the right use; engine members are known at build time.
- **Side-effect self-registration.** A member calls `register(x)` when
  imported (jQuery plugins, Mocha globals, the repo's `registerFileType`).
  Costs: correctness depends on import order and on something importing the
  member for its side effect, which is exactly what tree-shaking and
  dead-code tools remove. Rejected.
- **Generated registry.** A script writes the list from the directory and a
  check verifies freshness (protobuf and GraphQL codegen, Angular's schematics
  barrels). Buys: mechanical. Costs: a generator to maintain, generated files
  in review, and merge conflicts identical to the list's. A completeness
  check on a hand-written list gives the same guarantee with no generator.
  Rejected.
- **Typed exhaustiveness.** Where the key set exists as a union independent
  of the registry, `satisfies Record<Union, Member>` makes a missing member a
  compile error (`code-style.md`, "Exhaustiveness"). In this tree the union is
  usually derived from the registry (`getCardTypes()`,
  `src/schemas/registry.ts:399`), so the directory listing, not a union, is
  the independent source of what exists. Used where a union exists; not a
  substitute for the completeness check.
- **Module-directory entry names.** Rust `mod.rs` (now discouraged in favour
  of `foo.rs` beside `foo/`), Python `__init__.py`, Node `index.js`. All three
  ecosystems moved toward or recommend naming the entry after its role. Rule 6
  follows that direction.

- **Architecture-test tools.** dependency-cruiser
  (https://github.com/sverweij/dependency-cruiser) and
  eslint-plugin-boundaries express rules over the import graph by path
  pattern: forbidden edges, orphans, reachability, "only this folder may
  import that one". ArchUnit is the same idea for the JVM. Rules 2, 3, and 9
  are expressible there without a bespoke script; rules 1, 5, and 8
  compare listings with registries and mirrors, which those tools do not do.
  Neither is installed in this repo today. The check design decides whether
  to adopt one for the import-edge rules or to keep one script over the graph
  `bin/test-graph.ts` already builds.

No prior art found for a lint that checks "every file in a directory is a
member of its registry"; that part of the check is a repo script (anchor
issue, "Constraints for the check").

## Ontology

- **Subject directory**: a directory whose children are the parts of one
  subject (`core/chat/`, `core/capture/`, `components/chat/`). Named by a
  singular noun. Partitioned on one axis.
- **Scope of the rules**: modules (files the import graph sees: `.ts`,
  `.tsx`) and test files. Data files (fixtures, `.card`, `.html`, `.svg`,
  worklets, assets) are opaque to the rules and take the shape their consumer
  requires; test data lives under `test/fixtures/`.
- **Set directory**: a directory whose children are interchangeable
  instances of one contract (`schemas/`, `cli/commands/`, `trpc/routers/`,
  `scripts/migrate/`). Enumerated by one registry, which is what makes it a
  set; the name is free.
- **Registry**: the one module that imports every member of a set and
  declares the set by calling `defineRegistry` (rule 4). Lives in the set
  directory's parent (`trpc/router.ts` for `trpc/routers/`).
- **Public surface**: a module that `package.json` `exports` maps a
  specifier to. The one place a re-export module is allowed (rule 6).
- **Member**: one child of a set directory. A file, or a directory whose
  entry module is named after the contract (`health/router.ts`,
  `personality/schema.tsx`, `wakeup/command.ts`).
- **Entry**: a module in a directory that something outside the directory
  imports (in a set, the registry's import of a member). Read from the import
  graph; the registry is excluded by declaration.
- **Unit**: an entry plus the sibling modules reachable from it by imports
  inside the directory and from no other entry. Two entries whose reachable
  sets overlap share infrastructure; they are not one unit.
- **Infrastructure**: a module inside a directory reachable from two or more
  entries (the loader, a shared field helper). Not a member; not private to
  one unit.
- **Decoy**: a directory whose name promises content held elsewhere
  (`frontend/src/audio/` holds one worklet; the audio code is
  `frontend/src/lib/audio/`). Engineering principle 7's own example.
- **Mirror**: the test directory that corresponds to a source directory
  (`test/core/chat/session/` for `src/core/chat/session/`).
- **Behaviour group (tests)**: a subdirectory of a mirror that holds
  multi-module tests of one behaviour and has no source counterpart
  (`test/tours/`, `test/user-stories/`).

## Tracks / scope

### Findings from the survey (2026-09-26)

Counts are files directly in the directory, without subdirectories, `.ts`,
`.tsx`, `.md`.

- **Large flat directories are mixed-kind, not just large.** Every directory
  over 60 files holds members of a set beside things that are not members.
  `cli/commands/` (96) has roughly 30 helpers beside its verbs: `validate-*`
  ×7, `wakeup-*` ×7, `session-*` ×4, `drive-*` ×5, `tick-*`, `secrets-*`. It
  fails the boxholder's one-per-verb test the same way `schemas/` (84) does.
  The file count is the symptom; the mixed kinds are the cause.
- **Sibling imports separate members from everything else.** In `schemas/`,
  the real schemas (`memo.ts`, `recipe.tsx`, `landmark.ts`) import no sibling.
  Every sibling edge belongs to something else: the guide compiler
  (`guide.tsx` → `guide-compile`, `guide-parse`, `guide-elements`,
  `guide-templates`), the personality subsystem (five files), the templates
  subsystem (`templates-builtins.ts` imports a dozen schemas, so it is a
  second registry, not a member), and shared field helpers
  (`named-entity-fields.ts`, imported by `person.tsx` and `place.tsx`). One
  member imports another: `question-followup-job.ts` → `question.js`. The
  import graph, not the file name, tells them apart.
- **Subsystems were flattened at three depths.** `connectors/` holds four
  subsystems by prefix (`drive-*` ×25, `google-*` ×21, `gmail-*` ×13,
  `telegram-*` ×7). `core/chat/session/` is already two levels down and is
  itself flat at 50 files (`registry-*` ×7, `delete-*` ×5, `start-*`).
  `trpc/routers/health.ts` imports nineteen `health-*` siblings: a sub-set
  with its own registry, flattened into the parent set.
- **`index.ts` means two things.** Twenty `index.ts` files. Two are barrels
  (`schemas/index.ts`, 79 re-exports; `renderers/index.ts`, whose header
  says *"so existing imports don't churn"*, the rationale the barrel ban
  rejects). Eighteen are ordinary modules that happen to be named `index`:
  `core/chat/session/index.ts` (442 non-blank lines), `core/docs-gen/index.ts`
  (424), `core/box/index.ts` (415), `core/transcription/index.ts` (299). The
  four largest also exceed the 300-line file limit. The name says nothing
  about which it is.
- **Single-file directories.** Ten in `src/` and `test/`:
  `core/migrations/` (one file beside `core/migrations.ts` and five
  `migration-*.ts` in `core/`), `core/cards/`, `core/browser-task/`,
  `frontend/src/deploy-page/`, `frontend/src/types/`,
  `components/chat-husk/`, `components/system-cards/`, `test/core/cards/`,
  `test/core/markdoc/`, `test/core/chat/routing/`. Each is a name with no
  partition under it.
- **One decoy.** `frontend/src/audio/` (one `.worklet.js`) beside
  `frontend/src/lib/audio/` (29 files).
- **Tests mirror the top-level area only.** `test/core/` has 144 files beside
  19 subdirectories; 46 of the 144 have a subject subdirectory that already
  exists (`chat-session-*.doctest.md` ×10 beside `test/core/chat/session/`,
  which holds 8). `test/webapp/` has 36 `trpc-*` files beside
  `test/webapp/trpc/` (1 file). The test root mixes area mirrors, kind
  directories, and 21 loose doctests on one level. `bin/` colocates
  `*.test.ts` beside sources (38 files); `workstreams-app/test/` mirrors
  loosely. Three placements, one written rule.
- **Other areas have the same shapes.** `bin/` (104) is verbs beside `*-lib.ts`
  helpers beside tests, with `bin/lib/` and `bin/smoke/` as partial homes.
  `workstreams-app/src/router/` is 32 files that all repeat the directory
  name (`router-*` ×24, `workstreams-app-*` ×7). The rules below apply
  there unchanged; only the mirror root differs (rule 8).

### The principles

1. **A directory partitions its children on one axis, and the axis is
   legible from the names.** Subject directories partition by sub-subject;
   set directories partition by member. A reader who knows the axis can
   predict where a file lives and conclude from absence that it does not
   exist (engineering principle 7).
2. **Every file in a directory is the same kind of thing.** In a set
   directory, every child is a member. In a subject directory, every child is
   a sub-subject or a module of the subject itself. A loader, a compiler, a
   helper for one sibling, and a second registry are different kinds and go
   elsewhere.
3. **A thing lives at the lowest directory whose scope contains all its
   uses** (doc-structure principle 7, unchanged). A helper one module uses
   lives in that module's unit. A helper two sub-subjects share lives in the
   parent. A helper the whole engine shares lives in `src/lib/` or
   `src/shared/` per the module map.
4. **A name is a promise and is never repeated.** A file name does not repeat
   its directory's name; a directory's name is not held by a sibling module;
   a directory does not promise content held elsewhere.
5. **The import graph is the ground truth.** Membership, privacy, and sharing
   are read from who imports whom, not from file names. A rule that a script
   cannot check from names and imports needs a stated reason.

### The rules

Each rule gives the statement, the measure, whether a check can verify it
mechanically, and examples from the tree.

**Rule 1: a set directory holds members only.**
A set directory is declared by its registry (rule 4). It has
exactly one registry, every child is imported by that registry, and every
child exports one value of the set's contract. Anything else (a loader, a
shared field helper, a compiler, a second registry) lives outside the set
directory. The check finds sets by their `defineRegistry` declaration
(rule 4), never by the directory's name.
*Measure:* directory listing ⊆ registry imports, and registry imports ⊆
directory listing. The contract itself is verified by the registry's type
(`cardSchemas: CardSchema[]`, `src/schemas/registry.ts:90`): a listed module
that exports no value of the contract fails typecheck. A member may export
supporting values and types beside the contract value. *Mechanical:* yes,
given the declaration and the registry's location (rule 4).
*Examples:* `schemas/` fails today (twenty non-members). `cli/commands/`
fails (about thirty helpers). `trpc/routers/` fails (`health-*` ×19,
`chat-*-procedures` ×3, `landmark-payload`, `share-contract`).
`scripts/migrate/` passes against its path registry.

**Rule 2: members do not import each other's values.**
A member imports infrastructure and lower layers, never a sibling member's
runtime values. `import type` between members is allowed (type-only edges
carry no load order or cycle risk; `code-style.md` makes the same distinction
for madge). A value edge among members means one of two things: the imported
thing is shared vocabulary, so it is infrastructure (move it out, rule 3), or
the two files are one unit (make it a directory member, rule 5).
*Measure:* no value-import edge between two files the registry lists.
*Mechanical:* yes. *Examples:* `schemas/question-followup-job.ts:10` imports
the `QuestionLearning` field schema from `question.js`: two card types sharing
one field definition, so the field moves to the parent's field helpers beside
`named-entity-fields.ts` (already shared by `person.tsx` and `place.tsx`).

**Rule 3: a module imported by more than one unit is infrastructure and
leaves the directory it is shared across.**
Compute units from the directory's entries (see *Ontology*): a module
reachable inside the directory from two or more entries is shared; it moves
to the lowest directory that contains all its importers (principle 3). In a set directory that is
the set's parent, beside the registry. *Measure:* in-degree from distinct
units > 1. *Mechanical:* yes. *Judgment:* choosing a name for the new home
when the parent is not obvious. *Examples:* `connectors/google-auth.ts`
(imported by drive, gmail, and calendar) stays at `connectors/` level while
those three become subdirectories. `cli/commands/validate-markdown.ts`
(imported by three verbs) is the seam that shows `validate` is a subsystem,
not a verb with helpers.

**Rule 4: a set's registry lives in the set's parent, named for the set,
and declares the set with `defineRegistry`.**
The registry is `<parent>/<set>.ts` beside `<parent>/<set>/`:
`trpc/router.ts` already does this; `cli/surface-commands.ts` does with a
different name; `schemas/registry.ts` lives inside its set and moves out. The
registry is an explicit import list (see *Prior art* for why not discovery,
self-registration, or generation). It may hold the set's loader logic; it
holds no member.

One helper, `src/lib/registry.ts`, is the only way a set is built:

```ts
export const cardSchemas = defineRegistry({
  directory: "./schemas",          // string literal; the check reads it
  entry: "schema",                 // entry module name for directory members
  key: (schema) => schema.name,    // or "filename"
  ordered: false,                  // true where list order is semantics
  members: [MemoSchema, RecipeSchema, /* ... */],
});
```

`defineRegistry` returns a frozen, keyed `ReadonlyMap` and throws
`DuplicateRegistryKeyError` at construction. Its type parameter is the
contract, so a listed value of the wrong type fails typecheck.

How each property is verified:

- *Completeness, both ways (static).* The check parses every file that calls
  `defineRegistry` with the TypeScript compiler API, reads the `directory`
  literal, lists `<dir>/<name>.ts(x)` and `<dir>/<name>/<entry>.ts(x)`, and
  collects the file's import specifiers that resolve into `<dir>`. The two
  sets must be equal: a file without an import is an unregistered member; an
  import without a file is a stale entry. An import that is not placed in
  `members` is caught by the existing unused-import lint
  (`personal-vibe-check/preset.ts`, `no-unused-vars`).
- *Key uniqueness (runtime).* `defineRegistry` throws on a duplicate key.
  Every test that imports the registry, and the server at startup, exercises
  it. `test/lib/registry.doctest.md` covers the helper; a set's own test
  (`test/schemas.doctest.md`) asserts key matches file name where the set
  wants that.
- *Nothing else constructs the list (static).* Exactly one `defineRegistry`
  call names a given directory; no module outside the registry reads the set
  directory's path as a string (the `readdir` scan for box-local schemas in
  `src/schemas/registry.ts:10` builds a different list, the box's, and stays
  in the registry module); no side-effect registration API exists after the
  move (`registerConnector` and `registerFileType` are deleted, their callers
  replaced by list entries).
- *Order.* With `ordered: true` the list's order is the semantics
  (`MIGRATIONS`) and the check does nothing further. With `ordered: false`
  the helper sorts by key, so a reorder in the file is not a behaviour change.

There is no separate config: the registry file is the declaration. Adding a
member is: create the file, add one import and one list entry; the check
names whichever of the two was forgotten. *Measure:* as listed.
*Mechanical:* completeness, singleness, and path reads statically; key
uniqueness at runtime. *Not mechanical:* none.

**Rule 5: a unit above the size threshold is a directory; a member with
helpers is a directory member whose entry is named after the contract.**
The threshold is two (boxholder, 2026-09-26): the second file of a subject
is the moment to make the directory. A unit of two or more files becomes `<subject>/` with the files inside, prefix dropped (`code-style.md`). In a set, a member with private helpers becomes
`<member>/` with its entry module named for the contract: `health/router.ts`,
`wakeup/command.ts`, `personality/schema.tsx`. The registry imports the entry.
*Measure:* a unit of two or more files whose files share a directory with
files of other units. *Mechanical:* yes (unit computation from rule 3). *Judgment:*
the unit's name. *Worked example, `schemas/`:* `guide.tsx` is an entry (the
registry lists it); `guide-compile`, `guide-parse`, `guide-elements`, and
`guide-templates` are reachable only from it, so the five are one unit and
become `guide/` with `guide/schema.tsx` as the entry. `templates-builtins.ts`
is imported from outside the directory but is not on the registry, so rule 1
moves it out before units are computed. *Examples:* `cli/commands/wakeup.ts` + `wakeup-steps`,
`wakeup-outcome`, `wakeup-housekeeping`, `wakeup-cycle-lock`,
`wakeup-connectors` → `commands/wakeup/`. `core/chat/session/delete.ts` +
`delete-storage`, `delete-log`, `delete-husks`, `deletion-state`,
`stop-for-deletion` → `session/delete/`. `connectors/drive-*` ×25 →
`connectors/drive/` (and inside it, further units).

**Rule 6: no module is named `index`; re-export modules exist only as
public surfaces in `src/exports/`.**
`index.ts` today means barrel (banned) or "the main module of this
directory" (a name that says nothing and hides that four of them exceed the
file limit). The directory's principal module is named by what it does; if it
cannot be named, the directory's axis is unclear and that is the finding.

The four public specifiers are the one place a re-export module belongs,
because there its job is to define what is public rather than to blur it.
`src/exports/` already holds two of them (`schema.ts`, `server.ts`);
`src/cards/index.ts` (`beebox/cards`) and
`src/frontend/src/components/view-widgets/index.tsx` (`beebox/view-widgets`)
move there. `src/exports/` is then a set whose registry is the `package.json`
`exports` map: every file in the directory is a specifier's target and every
specifier targets a file there. Rule 1's completeness check reads the map
instead of a `defineRegistry` call.
*Measure:* basename is never `index`; a module containing only re-exports
lives in `src/exports/`; `exports` map ↔ `src/exports/` listing.
*Mechanical:* all three. *Examples:* `core/box/index.ts` (415 lines) splits
by what it does (`init`, `validate`, `open`, ...). `schemas/index.ts` is
deleted per the barrel ban; importers name the schema module.
`renderers/index.ts` goes with the side-effect registry it fronts.
`frontend/index.html` is data (Vite's entry), outside the rule's scope.

**Rule 7: a directory with a `CLAUDE.md` states its axis in the first
paragraph; no directory has an index page.**
This adapts doc-structure principle 8 (parent = index plus what is true of
the whole) rather than carrying it over: for source, `ls` is the index. A directory that carries guidance says on what axis its
children are split and what is true of all of them (doc-structure principle
8); it does not list children (a list drifts). *Measure:* none beyond
presence. *Judgment:* whether the stated axis matches the listing.
*Examples:* `src/services/CLAUDE.md` and `src/connectors/CLAUDE.md` already
explain what qualifies as a service or connector; each gains one sentence on
the axis.

**Rule 8: a package has one source root; its test root mirrors it
directory-for-directory and file-for-file; a test lives at the lowest mirror
that contains everything it imports.**
`<package>/test/<path>` mirrors `<package>/src/<path>`. A test of one module
carries that module's name; more tests of one module add a facet after a dot.
A test that exercises several modules lives in the mirror of the lowest
directory containing all of them and is named for the behaviour; such tests
may be grouped in a behaviour-group subdirectory whose name has no source
counterpart. Test helpers and fixtures follow rule 3: the lowest test
directory containing all their users, so a helper used across areas lives in
`test/helpers/` and shared data in `test/fixtures/`. Nothing under `test/`
needs an allowlist: every child is a mirror, a behaviour group, or support
placed by rule 3.

Two consequences make the rule exception-free and are decided in the move
plan: `beebox/scripts/` is a second source root today (mirrored at
`test/scripts/`) and folds into `src/` so there is one root; and
`src/frontend/` is a nested package with its own `package.json`, so its tests
mirror its own `src/` under `src/frontend/test/` rather than
`beebox/test/frontend/`.

Full paths under the rule:

| Subject | Test |
|---|---|
| `beebox/src/core/chat/session/history.ts` | `beebox/test/core/chat/session/history.doctest.md` |
| same module, a second facet | `beebox/test/core/chat/session/history.archive.doctest.md` |
| `beebox/src/cli/commands/wakeup/command.ts` | `beebox/test/cli/commands/wakeup/command.doctest.md` |
| `beebox/src/cli/commands/wakeup/steps.ts` | `beebox/test/cli/commands/wakeup/steps.doctest.md` |
| several modules of `session/` (no `lifecycle.ts`) | `beebox/test/core/chat/session/lifecycle.doctest.md` |
| the schemas registry `beebox/src/schemas.ts` | `beebox/test/schemas.doctest.md` |
| whole-app tour | `beebox/test/tours/<name>.tour.ts` (behaviour group at the root mirror) |
| `beebox/src/frontend/src/lib/docling.ts` | `beebox/src/frontend/test/lib/docling.doctest.md` |
| `bin/lib/schedules/store.ts` | `bin/test/lib/schedules/store.test.ts` |
| helper used by `core/agent` tests only | `beebox/test/core/agent/fake-agent.ts` |
| helper used across areas | `beebox/test/helpers/isolate-user-home.ts` |

*Measure:* three checks. Containment: every `src/` import of a test (doctest
fences or `.test.ts` imports; `.taprc:28-30` includes both) resolves inside
the test's mirrored directory or its descendants, or in `lib/`, `shared/`, or
a `test/` support module placed by rule 3. Naming: `X.doctest.md` or
`X.<facet>.doctest.md` in mirror `D` requires `X.ts`, `X.tsx`, or `X/` in
`D`'s source directory; a test with no counterpart must import at least two
modules of `D`. Structure: every directory under `test/` is a mirror of a
source directory or a behaviour group whose name has no source counterpart.
*Mechanical:* all three. *Judgment:* the behaviour name for a multi-module
test. *Examples:* `test/core/chat-session-archive.doctest.md` →
`test/core/chat/session/archive.doctest.md`. `test/webapp/trpc-health-*` →
`test/webapp/trpc/routers/health/`. The 21 loose files at `test/` root each
mirror a module below the root (`test/env.doctest.md` → `test/lib/env.doctest.md`).

**Rule 9: the module map's layer rules are unchanged and apply below every
new directory.**
`src/lib/` imports nothing upward; `src/shared/` is isomorphic; a subject
directory's helpers stay under it and never migrate to `lib/` unless they have
no `core/` dependency (`docs/module-map.md`). *Mechanical:* `pnpm
lint:circular` and the existing import-boundary lint rules.

### What the check needs from each rule

| Rule | Reads | Mechanical | Judgment left |
|---|---|---|---|
| 1 set purity | listing, registry imports | yes | none |
| 2 member independence | import graph | yes | which fix (extract or merge) |
| 3 shared infrastructure | import graph, unit computation | yes | new home's name |
| 4 registry declaration | `defineRegistry` calls, listing, imports | yes (keys at runtime) | none |
| 5 units become directories | import graph | yes | unit name |
| 6 no `index`; surfaces in `exports/` | basename, re-export shape, `exports` map | yes | new name |
| 7 `CLAUDE.md` states axis | presence | no | axis matches listing |
| 8 test placement | test imports, listing | yes | multi-module test name |
| 9 layers | madge, eslint | yes (exists) | none |

The check is a repo script under `beebox/src/dev/` run from pre-commit on
the changed directories. Its only configuration is the list of package roots;
sets are found by `defineRegistry`, public surfaces by `package.json`, and
there is no allowlist or ignore list. Rules 1 to 5 and 8 share one
import-graph pass;
`bin/test-graph.ts` already builds that graph for test selection and is the
candidate to reuse.

### Application to other areas

- **`bin/`**: the root is the set of executables a person types; the
  registry is the shell entry points and `package.json` scripts, which the
  check treats as the registry. Helpers move to `bin/lib/` (which exists) or
  to units under it; `*.test.ts` moves to `bin/test/` mirroring `bin/lib/`
  (rule 8). `smoke-*` ×11 and `test-*` ×20 are two subsystems with partial
  homes already (`bin/smoke/`).
- **`workstreams-app/`**: `src/router/` drops the `router-` prefix (rule 4 of
  the principles) and splits by unit; `src/server/` likewise.
  `workstreams-app/test/` already mirrors and adopts rule 8's file-for-file
  form.
- **`beebox-clerk/`, `scan-uploader/`, `agent-doctest/`, `canvas-loop/`**:
  the rules apply; none has a directory over 31 files today, and
  `scan-uploader/src` is one file by contract (single-file client). No action
  from this plan.

## Could this be simpler?

Simplest: rule 5 alone (units become directories), applied by the check.
That removes the prefix clusters but leaves set directories mixed
(`schemas/` would still hold its compilers) and leaves `index.ts`,
single-file directories, and test placement as they are. The boxholder named
each of those as a problem, so the fuller set of rules is the scope.

Considered and dropped: a per-directory manifest or `MAP.md` listing members
(a second registry, drifts; the import graph already is the manifest); a
file-count ceiling (counts cannot say when flat is valid); a filename-prefix
rule (evidence, not a rule; the boxholder's ruling); generated registries
(*Prior art*); source-directory index pages carried over from doc-structure
(`ls` is the index and a page would drift).

## Subplans

None. The check and the move each get a plan of their own when the boxholder
opens those steps; this document is their input.

## Failure modes

- **The rules produce many two-file directories.** Rule 5 fires on the
  second file. That is the intent (see *Stated preferences*, trade-off) and
  the boxholder accepted it.
- **Explicit lists change connector load order.** Today a connector is
  registered when its module happens to be imported
  (`src/connectors/index.ts:100`); an explicit list registers all six at one
  place. Anything that relied on a connector being absent because its module
  was never imported (a test with a partial import set) surfaces when rule 4
  is applied. Found by the tests; fixed in the move step, not here.
- **A set with a runtime-discovered half.** `schemas/registry.ts:10` also
  scans a box's schema directory. Rule 1 covers engine members; the runtime
  scan is loader logic and stays in the registry module.
- **A member that legitimately imports another member.** Rule 2 forces a
  choice. If cross-model review finds a case where neither extraction nor
  merging is right, the rule gains a stated exception, not a suppression.
- **Registry outside the set breaks a package export.** `beebox/schema` and
  `beebox/cards` are public specifiers (`beebox/CLAUDE.md:45`). The move step
  keeps the `package.json` `exports` map pointing at the new registry path;
  boxes never import the path.
- **Path-coupled tooling.** Skills and docs name `src/core/`, `src/lib/`
  paths in 29 files; `eslint.config.ts:183` ignores one file by path; knip's
  `project` globs name `src/schemas/**/*.list-entry.tsx`. The move plan
  inventories these; this plan only notes that the check must not depend on
  any path it moves.
- **Nested frontend package.** `src/frontend/` has its own `package.json`.
  Rule 8 gives it its own `test/`; tap in the outer package must include it.
- **The check flags the whole tree on day one.** Expected: the move window
  clears it. Until then the check runs in report mode on changed directories
  only, so a commit that adds a file to an already-failing directory is told
  which rule it broke without blocking on pre-existing debt. The anchor
  issue's constraint stands: the check is not weakened to pass; report mode
  is a rollout state that ends, in the move plan, at zero findings with no
  ignore list.

## Agent-flow / user-flow edge cases

- **An agent adds a helper for one verb.** Today: `commands/foo-helpers.ts`.
  Under rule 5: the check says `foo.ts` and `foo-helpers.ts` are one unit in a
  set directory and asks for `commands/foo/command.ts` + `commands/foo/helpers.ts`
  (or a better name). The agent moves both and updates the registry import.
- **An agent adds a schema that reuses fields from another schema.** Rule 2
  flags the member-to-member edge. The agent extracts the fields to the
  parent's field helpers, or decides the two are one member.
- **An agent writes a doctest for a module three levels down.** Rule 8 puts
  it at the mirror; the doctest doc's "mirroring the source path" sentence is
  now literal.
- **An agent needs a place for a cross-cutting helper.** Rule 3 and the module
  map answer: lowest common directory; `lib/` only with no `core/` dependency.
- **A directory's `CLAUDE.md` says one axis and the listing shows two.** Rule
  8 is the judgment rule; the check cannot see it. It surfaces in review and
  in the periodic codehealth pass.

## NOT in scope

- The check itself (step 3) and any move (step 4). No file moves in this
  workstream.
- Editing `beebox/docs/` reference pages: the doc-structure workstream owns
  them. The reference home for these rules (the module map or a page it
  links to, per the anchor issue) is chosen with that workstream when it
  finishes; until then this plan is the home.
- Splitting the over-limit `index.ts` modules by content. Rule 6 renames;
  the 300-line rule already owns the split.
- Changing what a set's contract is (what a schema, command, or router
  exports). The rules read contracts; they do not redefine them.
- iOS (`ios-app/`): Swift and Xcode groups; different tooling, not surveyed.

## Open design questions

Decided 2026-09-26 by the boxholder: the unit threshold is two; member
entries use the contract name; the minimum-two-children rule is dropped; no
rule has an exception (the plural convention, the `exports` exemption, the
fixture exemption, and the test kind allowlist were removed by generalizing
the rule or dropping it).

- **Mirror or colocate tests.** Rule 8 keeps the mirror. The alternative
  puts each test beside its subject
  (`src/core/chat/session/history.doctest.md`), which removes the mirror
  and the structure check and moves a unit and its tests in one `git mv`,
  at the cost of roughly doubling every source directory's listing and
  changing tap, eslint, and knip globs. Recommendation: mirror, because the
  complaint that opened this work is listing size.
- **Nested frontend package.** Rule 8 puts frontend tests under
  `src/frontend/test/`. The alternative keeps `beebox/test/frontend/` and
  treats `src/frontend/src/` as the mirrored root, an exception to "one
  source root per package". Recommendation: `src/frontend/test/`.
- **Fold `scripts/` into `src/`.** Required for rule 8 to have one root.
  Where under `src/` (`src/scripts/` or into `src/dev/`) is a move-plan
  decision.

## Knowledge audits

Not applicable: these rules are dev-repo guidance, invisible to box agents.
The box-side layout (`docs/box-layout.md`) is a separate contract and is not
changed.

## What will hold this after it ships

- The check (step 3) on pre-commit, reading the import graph.
- `code-style.md` file-naming section and the module map point to the rules'
  home once doc-structure settles it.
- The codehealth skill's pass includes rule 7 (axis stated matches listing),
  which the check cannot see.

## Implementation order

1. This plan, cross-model reviewed; anchor issue updated with the decisions.
2. Boxholder settles the three open questions.
3. Check design and implementation (own plan; report mode first).
4. Move window (own plan; BIG CHANGE approval; no other workstream active).

## Rollout shape

Rules land as a document. Nothing in the tree changes until step 3 ships and
the boxholder opens the move window.
