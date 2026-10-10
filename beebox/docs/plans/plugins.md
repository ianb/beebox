---
title: "Plugins: typed in-repo libraries a box uses through stubs"
status: draft
workstream: plugins-planning
issues:
  - ../../../issues/exploration/2026-08-19-plugins-and-the-medium-content-line.md
  - ../../../issues/exploration/2026-09-24-agent-plugins-spec.md
---
# Plugins: typed in-repo libraries a box uses through stubs

A plugin is a typed library shipped inside the `beebox` package and reached
through a public subpath. A box uses it by listing it in `_config/box.json`
and writing small stubs that import and extend it. Nothing new runs at
runtime: stubs are ordinary box schemas, views and tricks. The first plugin is
courseware; the decisions behind the shape are in
[plugins-design-notes.md](plugins-design-notes.md).

**Issues addressed:** [plugins and the medium/content line](../../../issues/exploration/2026-08-19-plugins-and-the-medium-content-line.md)
(the design this implements), [Agent Plugins spec](../../../issues/exploration/2026-09-24-agent-plugins-spec.md)
(evaluated; rules borrowed, format not). Related, not closed by this plan:
[canonical wisdom corpus](../../../issues/exploration/2026-05-11-canonical-wisdom-corpus.md)
(the instruction tier's frontend), [starter manifest](../../../issues/features/2026-10-08-starter-manifest-and-scripted-first-turn.md)
(a starter will activate plugins), [course study home](../../../issues/features/2026-09-21-course-study-home-last-next-uncertain.md)
(a courseware view, built after the move). Searched the queue for
`plugin`, `courseware`, `connector plugin`, `exposition`: no duplicate plan.

## Design

Design subplan: [plugins.design.md](plugins.design.md). It covers the two
things a person meets: the agent's answer to "can this box do courses?", and
what a box with an inactive plugin shows. Everything else in this plan is
infrastructure.

## Smallest fix and budget

**Smallest fix.** Export the built-in schema configs from `beebox/cards` and
document that a box stub may spread them. One file in `src/exports/cards.ts`,
one doc paragraph. It gives "extend a core type" and nothing else: no
activation, no advertisement, no health, nothing moves out of core.

**Chosen design, slice 1 (this plan's shipping unit):** the plugin mechanism
plus courseware moved onto it. Estimated changed lines (additions plus
deletions, like-for-like):

| Chunk | Source | Tests |
|---|---|---|
| Plugin registry, `definePlugin`, exports map, layout and import rules | 220 | 120 |
| `plugins` in box.json, `bbx plugins list`, agent-guide line, skill mirror | 200 | 150 |
| Four core health checks, `lintCards` dispatch | 180 | 160 |
| `extendSchema` helper, built-in bases exported | 90 | 80 |
| Courseware move (five schemas, concept-map view, skill, docs, lint): mostly moves | 900 | 250 |
| Drop exposition rules compiler and its surface entry | 150 | 60 |
| Rename `plugins/` (agent-harness) to `harness-plugins/` | 40 | 10 |
| **Total** | **1,780** | **830** |

Authored docs separately: `docs/plugins.md` authoring guide (~150 lines),
courseware README and SKILL.md (~120, mostly moved from `skills-content.ts`),
`extensibility.md` revision (~20).

**BIG CHANGE.** Source plus tests is about 2,600 changed lines. About 900 of
that is courseware files moving with import rewrites, counted as deletions
plus additions. The boxholder agreed the direction and the first slice on
2026-10-09; this label asks for approval of the size. Slices 2 (scoped
Markdoc tags, conventions enforcement) and 3 (connectors) are separate plans.

What the fuller design buys over the smallest fix: a box can hold a course
type without the engine shipping it as always-on (principle 7: absence means
it does not exist), the agent learns a plugin exists through one listing
rather than a per-type guide entry, and a missing or half-done activation is a
health failure rather than a silent unknown type (principle 4).

## Stated preferences this plan trades against

- [extensibility.md](../design/extensibility.md): "knowledge, not plugins",
  with "no plugins" meaning no registry, marketplace, or lifecycle framework.
  This plan adds none of those. It adds a listing in box.json and a typed
  library boundary. The doc is revised to name the mechanism and keep the
  prohibition.
- `docs/box/schemas.md:204`: *"Schema and view code ... may only import from
  the beebox library surface: `beebox/cards` ... `beebox/schema` ...
  `beebox/view-widgets`."* This plan adds `beebox/plugins/<name>` and
  `beebox/plugins/<name>/view` to that surface. Trade: a wider public API,
  versioned with the engine so there is no peer-range problem.
- `docs/box-layout.md:259`: *"No Bee Box application/server code"* in a box.
  Held: a stub imports engine-shipped code; it does not contain it.
- Principle 8 (one way to do each thing): courseware guidance today reaches
  the agent through a derived rules compiler
  (`src/core/compile-exposition-rules.ts:1-10`). Boxholder decision
  2026-10-09: drop it; course guidance is a nested `AGENTS.md` the agent
  writes. One way (AGENTS.md), one fewer generator.
- Principle 11 (enforcement beats convention): the rule "a plugin imports only
  the public specifiers and its own directory" is a layout rule and an
  import-lint block, not a paragraph.
- Boxholder, 2026-10-09: tags are local to the type; no derived-rules hook;
  migration is agent-run from docs; only project-shipped plugins; new boxes
  activate nothing; no in-process event hooks (the
  [OpenClaw](../../../research/openclaw-hermes/deep-openclaw-plugins.md) and
  [Hermes](../../../research/openclaw-hermes/deep-hermes-plugins.md) notes).
- Shipped precedent: [boxes-as-packages-v2](../implemented-plans/boxes-as-packages-v2.md)
  named `pnpm add some-box-plugin` as "enabled by the layout" and out of
  scope; this plan is the in-repo form of that.

## What already exists

Reuse, all of it:

- **Type name separate from config.** `src/cards/schema.ts:523-530`:
  `cardSchema(type: TTag, config: CardSchemaConfig<...>)`. A config without
  a type is already an abstract base.
- **Box schema loading and override.** `src/schemas.ts:434-445`:
  `createCardSchemaMap` merges box schemas over built-ins, *"A box schema
  whose type collides with a built-in wins (last write)"*. Keep-last-good on a
  broken file: `src/schemas.ts:333-334`.
- **Box view compiler bundles from the box's node_modules.**
  `src/webapp/views/compiler/compile.ts:199-211`: `bundle: true`,
  `resolveDir: path.dirname(viewPath)`; shims only `react`
  (`compile.ts:65`) and `beebox/view-widgets` (`compile.ts:115`).
  `rendersCardTypes` validated at `meta-import.ts:52`.
- **Public exports map.** `package.json:6-21` lists `./cards`, `./schema`,
  `./server`, `./view-widgets`, `./tsconfig.base.json`.
- **Generated, marked skills.** `src/core/box/guidance-sync/skills.ts:56-63`
  builds a static list; `:115-119` prunes only DOCID-marked directories, so
  box-authored skills survive. Surface registered at
  `guidance-surfaces.ts:110`.
- **Agent guide card-type list** reads `brief`:
  `src/core/agent-guide/guide/cards.ts:63-66`.
- **Box-local card docs** are generated for any box schema with
  `instructions`: `src/core/docs-gen/box-docs.ts:18`: *"`card-<type>.md` for
  each BOX-LOCAL schema with `instructions`"*. A stub that spreads a base
  carrying `instructions` documents itself.
- **Health checks** are one list: `src/webapp/trpc/routers/health/router.ts:156-161`
  `runHealthChecks`, `HealthCheck` at `:50-56`.
- **Box config** is a TypeScript interface, not Zod:
  `src/core/box/config.ts:19` `export interface BoxConfig {`; read at `:355`
  from `_config/box.json`; `agentEngine` validated by hand at `:207`.
- **Closed registries** use `defineRegistry` (`src/shared/registry.ts:68`),
  with a layout rule set that checks members and imports
  (`src/dev/layout/check/rules.ts:12-17`, `model.ts:152-156` `LayoutRule`).
- **Import restriction lint** exists for list entries:
  `eslint.config.ts:162-183` `@typescript-eslint/no-restricted-imports` with
  path groups. The plugin boundary is one more block.
- **Tricks**: discovery `src/cli/commands/trick.ts:78-83`, description read by
  regex from `export const description = "..."` (`:59-65`), run as a
  subprocess with `buildScriptEnv` (`:124-141`), commit with `Run-By`
  trailer (`:37-46`).
- **Upgrade** typechecks under the new engine before committing:
  `src/cli/commands/upgrade.ts:1-28`; migrations ledger
  `src/core/migrations.ts:57`, entries like `:133`.
- **Verb classification**: `src/cli/entry/surface-data.ts:55` `SURFACE`, e.g.
  `:84` `{ name: "trick", audience: "agent", smoke: ... }`.
- **Throwaway box for tests**: `test/helpers/doctest-helpers.ts:48`
  `makeTmpBox({ git, deps })`; precedent doctest
  `test/webapp/views/compiler.lint-hooks.doctest.md:36-52`.

Courseware today (all moves): `src/schemas/{course,lesson-plan,exposition-plan,progress,concept-map}.ts`
(each imports only `../exports/cards.js` and zod; `concept-map.ts` adds
`type LintIssue`), `src/templates/courseware.ts` (registered at
`src/templates.ts:35`), `buildCourseSkill` at
`guidance-sync/skills-content.ts:18` with `FIGURE_EXAMPLES`, the concept-map
renderer (`src/frontend/src/renderers/concept-map.tsx`,
`components/concept-map/*`), the node-refs lint
(`src/core/card-lint/core/node-refs.ts:2-4`: *"Two courseware card types name
concept-map nodes by their `id`"*) dispatched by type at
`lint-cards.ts:287-292`, the exposition rules compiler
(`compile-exposition-rules.ts`, called from `refresh-derived-rules.ts:18`
and `docs-gen/generate/core.ts:450-451`, surface at
`guidance-surfaces.ts:107`), and `box-docs/card-{course,exposition-plan,concept-map}.md`.
Tests: `test/core/compile-exposition-rules.doctest.md`, and courseware cases
in `test/schemas.doctest.md`, `test/core/card-lint.doctest.md`,
`test/core/box/guidance-sync/skills.doctest.md`,
`test/core/docs-gen/generate.doctest.md`.

Not reused, with reason: the Hermes `register(ctx)` and OpenClaw `register*`
runtime APIs (rejected in both research notes); the template tracker for
code pieces (stubs are never overwritten, so they need no parking).

## Prior art (external)

- **Explicit listing over node_modules scanning** (adopted as a pattern, no
  code copied): Prettier 3 removed automatic plugin discovery from
  node_modules and requires listing
  (https://prettier.io/blog/2023/07/05/3.0.0#plugin-autoloading-is-removed).
  ESLint flat config imports plugins explicitly. OpenClaw and Hermes both
  reached explicit allow-lists; details in the research notes.
- **Declared ownership read before code** (adopted as a pattern): OpenClaw's
  manifest `contracts` and VS Code's `contributes`. Here the plugin object's
  declarative fields are read without running hooks.
- **Agent Plugins spec** (evaluated only): root containment, skip invalid
  components, no credentials in the package. The envelope is not used.
- **TiddlyWiki shadow tiddlers** (evaluated only, `research/tiddlywiki/plugins.md`):
  overlay by identity. Not used; stubs import rather than shadow.
- **Hermes left-core migration** (evaluated only): auto-install the plugin
  when a feature leaves core. Boxholder chose manual, agent-run migration.
- No prior art found for "a plugin exports an abstract schema config that the
  host's own `cardSchema(type, config)` completes". That falls out of the
  existing signature.

ACKNOWLEDGEMENTS.md gets no new entry: the adopted items are patterns already
credited to OpenClaw and Hermes in the research corpus, not copied code.

## Ontology

Existing names, used as-is:

- **Card schema** (`CardSchema`, `src/cards/schema.ts`): a type name plus a
  resolved config. **Card schema config** (`CardSchemaConfig`): the fields,
  hooks and prose without a type name.
- **Box schema, view, trick**: box-authored files under `src/schemas/`,
  `src/views/`, `src/tricks/scripts/<name>/`.
- **Managed skill**: a DOCID-marked `.claude/skills/<name>/SKILL.md` the
  engine regenerates (`guidance-surfaces.ts:110`).
- **Health check** (`HealthCheck`, `health/router.ts:50`).
- **Connector** (`src/connector.ts:13`). Not touched in slice 1.
- **Agent-harness plugin**: `plugins/beebox-claude`, `plugins/beebox-codex`,
  the Claude Code and Codex plugins that install the validate hook. Renamed
  directory `harness-plugins/` to free the word.

New names:

- **Plugin**: a directory `src/plugins/<name>/` in the engine, exported as
  `beebox/plugins/<name>` (Node) and `beebox/plugins/<name>/view` (browser),
  whose `index.ts` default-exports a `PluginDefinition`. Identified by
  `name`, kebab-case, equal to the directory. It is NOT a box file and NOT a
  runtime registration; it is a library. Points at: bases, a view module, a
  skill text, docs, hooks.
- **Base**: a `CardSchemaConfig` a plugin exports, keyed by its default type
  name in `PluginDefinition.schemas`. NOT a `CardSchema` (it has no type).
- **Stub**: a box file that imports a plugin and completes it: a box schema
  calling `cardSchema(type, extendSchema(base, delta))`, a box view
  re-exporting the plugin's view, a trick calling the plugin's script. Owned
  by the box; never overwritten by the engine.
- **Installed**: present in the engine package. Every in-repo plugin, always.
- **Active**: named in `BoxConfig.plugins`. Identified by name. The only
  mechanical state. NOT "stubs exist" (that is checked, not stored).
- **Hook**: one of the enumerated optional functions on `PluginDefinition`:
  `healthChecks(boxRoot)`, `lintCards(input)`. NOT an event subscription.
- **Tier**: instruction, trick, plugin. A vocabulary for the authoring
  guide, not a code concept.

```ts
// src/plugins/types.ts (public through beebox/plugins/<name> re-exports)
export interface PluginDefinition {
  readonly name: string;                 // equals directory name
  readonly description: string;          // one line; passes the brief lint
  readonly docs: string;                 // path under the package, e.g. "src/plugins/courseware/README.md"
  readonly skill?: string;               // SKILL.md body; engine writes frontmatter
  readonly schemas?: Readonly<Record<string, CardSchemaConfig<string, Record<string, FieldDecl>>>>; // key = default type
  readonly views?: ReadonlyArray<{ readonly name: string; readonly rendersCardTypes: ReadonlyArray<string> }>;
  readonly scripts?: ReadonlyArray<{ readonly name: string; readonly description: string }>;
  readonly healthChecks?: (boxRoot: string) => Promise<HealthCheck[]>;
  readonly lintCards?: (input: { path: string; type: string; fields: Record<string, unknown>; boxRoot: string }) => Promise<LintIssue[]>;
}
export function definePlugin(def: PluginDefinition): PluginDefinition;
```

## Tracks / scope

### Track 1: plugin registry and boundary

**What.** `src/plugins/` with a `defineRegistry` of plugin definitions,
`definePlugin`, the exports-map entries, and the enforced import boundary.

**Why.** Without a registry the engine cannot list plugins or read their
declarations. Without the boundary an in-repo plugin is core by another
name.

**Direction.**

- `src/plugins/registry.ts`: `export const plugins = defineRegistry<PluginDefinition>({ directory: "./", entry: "index", ordered: false, members: { courseware } })`.
  The existing `registry-location` and `member-imports` layout rules apply.
- `package.json` `exports` adds `"./plugins/*": { types: "./dist/plugins/*/index.d.ts", default: "./dist/plugins/*/index.js" }`
  and `"./plugins/*/view": { types: "./dist/plugins/*/view.d.ts", default: "./dist/plugins/*/view.js" }`.
  Two entries because `index.ts` may import `node:fs` for health checks and
  `view.tsx` must stay browser-safe; the view compiler bundles whatever the
  stub imports (`compile.ts:206`).
- `files` adds `src/plugins/*/README.md` so docs are readable at
  `node_modules/beebox/src/plugins/<name>/README.md`, the way box agents read
  `node_modules/beebox/box-docs` today.
- Boundary: a new layout rule `plugin-imports` in `src/dev/layout/check/rules/`
  (registered at `rules.ts:12-17`): a file under `src/plugins/<name>/` may
  import only `src/exports/*`, `src/plugins/types.ts`, its own directory, and
  external packages. Mirrored as an `eslint.config.ts`
  `@typescript-eslint/no-restricted-imports` block for `src/plugins/**`
  (pattern of `:162-183`) so the editor shows it.
- Rename `plugins/` to `harness-plugins/`: `package.json` `files`,
  `src/core/agent/plugin-paths.ts:8` (`resolveHarnessPluginPath`), the Codex
  installer, `.agents/plugins/marketplace.json`, docs mentions.

**Vocabulary lock-ins.** `beebox/plugins/<name>`, `beebox/plugins/<name>/view`,
`PluginDefinition`, `definePlugin`, `src/plugins/<name>/{index.ts,view.tsx,README.md,SKILL.md}`.

**First chunk.** Rename the harness directory; add `src/plugins/types.ts`,
`registry.ts` with an empty members object, the exports entries, the layout
rule and lint block, and a doctest that a fixture plugin importing
`src/core/...` fails the layout rule.

### Track 2: activation, listing, advertisement

**What.** `BoxConfig.plugins`, `bbx plugins list`, the agent-guide line, the
mirrored skill.

**Why.** The agent must learn a plugin exists ("it has to know something
exists first") without inactive plugins costing context or complexity.

**Direction.**

- `config.ts:19` `BoxConfig` gains `plugins?: string[]`. Validation beside
  `agentEngine` (`:207`): every name must be a registry key; an unknown name
  is a config error reported the way an unknown engine is, and `bbx status`
  shows it.
- `activePlugins(boxRoot): PluginDefinition[]` in `src/core/plugins/active.ts`.
- `bbx plugins list` (`surface-data.ts:55`: `{ name: "plugins", audience: "agent", smoke: { run: ["plugins", "list"] } }`):
  one line per installed plugin: name, active or inactive, description, docs
  path. Only subcommand in slice 1.
- Agent guide (`agent-guide/guide/cards.ts`): one standing line in the
  capabilities section, *"Other plugins: `bbx plugins list`"*. Active
  plugins' types already appear through their stubs' `brief`.
- Skills: `skills.ts:56` `buildBoxSkills` takes the active plugins and adds
  `{ name: plugin.name, content: frontmatter(plugin.description) + plugin.skill }`
  for each with a `skill`. Marked and pruned like the rest (`:115-119`).
  Deactivation removes the skill on the next sync.

**Vocabulary lock-ins.** `plugins` key in box.json; verb `bbx plugins list`;
skill name equals plugin name.

**First chunk.** `BoxConfig.plugins` with validation, `activePlugins`,
`bbx plugins list`, a doctest with a fixture plugin.

### Track 3: health and lint hooks

**What.** Four core checks plus the two enumerated hooks.

**Why.** Boxholder: deactivation, rot and removal "can't brick the box or go
without being noticed".

**Direction.** In `runHealthChecks` after `templateUpdatesCheck` (`:224`):

- `plugin-cards-inactive`: cards whose type matches a default type key of an
  inactive plugin's `schemas` and no box schema defines it. Message names the
  plugin and `bbx plugins list`. Severity error.
- `plugin-stub-inactive`: a box schema, view or trick file imports
  `beebox/plugins/<name>` and `<name>` is not active. Warning. Detection is a
  regex over import specifiers in `src/schemas/*.ts`, `src/views/*.tsx`,
  `src/tricks/scripts/*/index.ts`, the same approach as `readDescription`
  (`trick.ts:59-65`).
- `plugin-stub-missing`: a stub imports `beebox/plugins/<name>` and the name
  is not a registry key. Error.
- `plugin-checks`: for each active plugin with `healthChecks`, append its
  results with `name` prefixed `<plugin>/`.

Box typecheck failing is already surfaced by `bbx upgrade`
(`upgrade.ts:21-23`) and `bbx view typecheck`; no new check.

`lintCards`: `lint-cards.ts:287-292` replaces its three type-specific
branches with a loop over active plugins' `lintCards`, called for every
card whose type has a box schema. Schema `validate` stays self-contained
(`schema.ts:240` comment: *"generic, box-aware checks ... stay in the host's
lint dispatch"*); `lintCards` is that dispatch, now pluggable.

**Vocabulary lock-ins.** Check names above; hook names `healthChecks`,
`lintCards`; the `<plugin>/` prefix.

**First chunk.** The four checks with doctests using `makeTmpBox`.

### Track 4: `extendSchema` and exported bases

**What.** A helper that composes a base with a delta, and the courseware
bases exported from the plugin.

**Why.** Spread replaces `validate` and `summarize`; the boxholder wants
"basically subclass".

**Direction.** In `src/cards/schema.ts`, exported through `beebox/cards`:

```ts
export function extendSchema<B extends CardSchemaConfig<string, Record<string, FieldDecl>>, D extends Partial<B>>(base: B, delta: D): Merged<B, D>;
```

Fields merge by key (delta wins); `validate` runs base then delta and
concatenates; `summarize` runs delta with base's result as `base`;
`instructions` concatenates with a blank line; scalar options are delta
wins. Exporting the built-in configs of core types (`doc`, `memo`, ...) is
NOT in slice 1; only plugin bases are exported. The helper works on any
config, so core bases are a later export, not a design change.

**First chunk.** `extendSchema` with a doctest for each merge rule.

### Track 5: courseware onto the mechanism

**What.** Move `course`, `lesson-plan`, `exposition-plan`, `progress`,
`concept-map`, the concept-map view, the build-course skill, the node-refs
lint, and the templates into `src/plugins/courseware/`. Drop the exposition
rules compiler.

**Why.** Courseware is content a box is about, not medium; it has no
frontend coupling beyond the concept-map renderer; it exercises every part
of the mechanism (schemas, a view, a skill, docs, a lint hook).

**Direction.**

- `index.ts`: `definePlugin({ name: "courseware", description: "Courses, lesson plans, learner progress", docs: "src/plugins/courseware/README.md", skill: BUILD_COURSE_SKILL, schemas: { course: courseBase, "lesson-plan": lessonPlanBase, "exposition-plan": expositionPlanBase, progress: progressBase, "concept-map": conceptMapBase }, views: [{ name: "concept-map", rendersCardTypes: ["concept-map"] }], lintCards })`.
  `exposition-plan` keeps its `rules` field for one release so existing
  cards validate; the README's migration section tells the agent to move
  those rules into the course directory's `AGENTS.md` and drop the field.
- `view.tsx`: the concept-map view, moved from `components/concept-map/*`
  and `renderers/concept-map.tsx`, importing only `beebox/view-widgets`
  and its own files. `renderer-display-label.ts` and `renderers.ts` lose the
  concept-map entries.
- Remove `compile-exposition-rules.ts`, its call sites
  (`refresh-derived-rules.ts:18`, `docs-gen/generate/core.ts:450-451`), the
  surface at `guidance-surfaces.ts:107`, and the doctest. Existing generated
  `exposition-*.md` files: the surface entry is replaced by a prune-only entry
  for one release so sync deletes them.
- `src/templates.ts:35` drops `courseware`; the templates move to the plugin
  and register through a `templates` field on `PluginDefinition` only if
  `bbx create` needs them. Decision: it does not in slice 1; the README shows
  the frontmatter instead. Lock-in: no `templates` hook.
- `src/schemas.ts:74-77,125-131`, `src/core/system-cards.ts` untouched
  (inventory stays), `box-docs/card-{course,exposition-plan,concept-map}.md`
  deleted; the generated box-local docs replace them when a stub exists.
- README sections: What it is, Setup (the exact stubs), Scripts (none),
  Migration (from engine ≤ this version), Uninstall.
- Migration entry in `MIGRATIONS` (`migrations.ts:57`): a procedure
  migration that, when `*.course.card` files exist, writes nothing and
  records a health-visible note pointing at the courseware README. The
  agent does the activation. This is the boxholder's "manual, agent-run"
  decision made mechanical only at the pointer.

**Vocabulary lock-ins.** Plugin name `courseware`; default type names
unchanged; stub file names `src/schemas/<type>.ts`, `src/views/concept-map.tsx`.

**First chunk.** Move the five schema configs to bases and the plugin
`index.ts`; `test/schemas.doctest.md` courseware cases move to the plugin's
doctest, which writes the README's stubs into a `makeTmpBox` and runs
`bbx validate`.

## Could this be simpler?

Simplest version: export the courseware configs from `beebox/cards`, delete
nothing, document the spread. No `plugins` list, no verb, no checks. It
fails on three cases, each traced:

- A box with no course stubs still sees five course types in its agent guide
  and card docs, so absence does not mean non-existence (principle 7), and
  the medium/content line is a comment.
- A box that upgrades past a courseware change has no place that says "this
  box uses courseware"; the stub's broken import is found by whoever reads
  the status page (principle 4: never silent).
- Nothing tells the agent courseware exists when it is not in the guide,
  so the agent cannot discover it at all, which defeats the point.

What the plan does not include, by the same gate: no `templates` hook (one
caller, and the README covers it), no scoped tags (slice 2, no consumer in
courseware), no `bbx plugins activate` verb (the agent edits box.json and
writes stubs from the README; a verb would hide which stubs were written),
no per-plugin version (versioned with the engine), no connectors hook
(slice 3).

## Subplans

- [plugins.design.md](plugins.design.md): the person-facing parts.
- Slice 2 and slice 3 are future plans, not subplans; they ship separately.

## Failure modes

> **Critical gap:** a plugin's `view.tsx` imports a Node built-in. The stub
> compiles in the view compiler and fails at browser import with a module
> error. Fix in plan: the `plugin-imports` layout rule forbids `node:*` and
> `src/**` outside `exports/` in `view.tsx`, and the plugin doctest compiles
> the view for the browser target.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Stub imports `beebox/plugins/x` after `x` is removed from the registry | new doctest | schema loader keep-last-good (`schemas.ts:333`); `plugin-stub-missing` check | clear: status, health |
| Box lists a plugin name that does not exist | new doctest | config validation like `agentEngine` (`config.ts:207`) | clear: `bbx status` |
| Course cards exist, plugin inactive, no stub | new doctest | `plugin-cards-inactive` | clear |
| Stub exists, plugin deactivated | new doctest | `plugin-stub-inactive` warning | clear |
| Base adds a required field in a later engine; cards on disk lack it | existing `bbx validate` | upgrade typecheck does not catch data; validation does | clear per card |
| Base renames a field the stub's delta references | upgrade typecheck (`upgrade.ts:21-23`) | upgrade fails before commit; `git reset --hard` | clear |
| Two active plugins export the same default type key | new doctest | registry check at load: duplicate keys are an invariant failure | clear, fails hard (dev) |
| Plugin `healthChecks` throws | new doctest | caught per plugin; reported as a failing check named `<plugin>/checks` | clear |
| Plugin `lintCards` is slow or throws on one card | new doctest | caught per card; a warning issue names the plugin | clear |
| Skill mirror for a deactivated plugin lingers | existing skills doctest pattern | marked prune (`skills.ts:115-119`) | clear on next sync |
| `exposition-plan.rules` still populated after the compiler is gone | migration note test | field kept one release; README migration; prune-only surface | clear via health |
| `readDescription`-style import regex misses a dynamic import | new doctest | documented: stubs use static imports (README) | silent for exotic stubs; accepted |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field.** ADDRESSED: default type keys are the only
  names a stub needs; the README shows the stub verbatim.
- **Stale ref.** DEFERRED: the node-refs lint moves unchanged; a stale
  concept-map ref is reported as today.
- **Two agents touching the same card.** ADDRESSED: `box.json` edits go
  through the existing config write path; stubs are new files.
- **Hand-edit drift.** ADDRESSED: a stub with the wrong type name is a box
  schema like any other; `plugin-cards-inactive` catches cards of a default
  type the box did not define.
- **Fabricated free-form value.** ADDRESSED: `plugins` entries must be
  registry keys.
- **Validation error UX.** ADDRESSED: messages name the plugin and the
  command to run; checked in the design subplan.
- **Partial migration.** ADDRESSED: an upgraded box with course cards and no
  activation is a visible health error until the agent acts; the
  `exposition-plan.rules` field survives one release.
- **Agent writes a stub without listing the plugin.** ADDRESSED: cards
  validate (the stub defines the type), the skill is absent, health warns
  `plugin-stub-inactive`.

## NOT in scope

- Scoped Markdoc tags on the schema (`markdocTags`) and the `Markdown` widget
  accepting tag components: slice 2, when recipes move.
- Connectors as plugins, Gmail and Drive, a generic calendar type: slice 3.
- Exporting core built-in configs as bases: when a box needs to extend one.
- `bbx plugins activate`: the agent edits box.json from the README.
- A plugin `templates` hook for `bbx create`: one caller, README suffices.
- User-authored plugins as separate packages with friction: project-only
  for now (boxholder).
- Removal of tab arrangements and Telegram: separate issues.
- The course study home view: a courseware view after the move.
- A per-box manifest or export verb ("every box starts with its own
  plugin"): the boxholder inclines against it; the design notes keep it open.
- Moving recipes, figures, judgment: later plans following this pattern.

## Open design questions

- Whether `bbx plugins list` should also print the active plugins' stub
  status (which README stubs exist). Lean: yes, it is the agent's
  declared-versus-present view and costs one glob per plugin.
- Whether the `exposition-plan.rules` field is removed in the release after
  this one or kept as prose for the agent. Lean: remove, with the migration
  note.

## Knowledge audits

New agent-facing concept: a plugin, how to find and activate one. Entries in
`src/dev/knowledge-audits.yaml` (shape at `:45-55`):

- `plugins-discover`: "A boxholder asks for a course on chemistry and this
  box has no course type. What do you do first?" Expected `knows_directly`:
  run `bbx plugins list`, read the courseware README, list the plugin in
  box.json, write the stubs.
- `plugins-extend`: "You want recipe-like cards to carry a rating. Where
  does the field go?" Expected: in the box's stub via `extendSchema`, not in
  node_modules.

Both run against `~/src/boxes/test1` before the plan is called done; status
recorded in the yaml comments.

## What will hold this after it ships

- Doctests (unit tier, `makeTmpBox`): registry and layout rule; box.json
  validation; `bbx plugins list` output; each health check; `extendSchema`
  merge rules; the courseware plugin's own setup doctest, which writes the
  README's stubs into a temp box and runs `bbx validate` and `bbx view
  typecheck`. The README stubs are the fixture, so the docs cannot drift from
  what compiles.
- The browser-target compile of `view.tsx` in the same doctest.
- Layout check and lint in pre-commit hold the import boundary.
- No new test tier. No mocks beyond the existing temp box.
- The decision "which plugin provides this unknown type" is a pure function
  over (card types on disk, registry, active list) and is doctested
  directly.

## Implementation order

1. Track 1 first chunk: rename harness plugins; `types.ts`, empty registry,
   exports entries, layout rule, lint block, doctest.
2. Track 4: `extendSchema` and doctest.
3. Track 5 first chunk: courseware bases and `index.ts`; register in the
   registry; plugin doctest skeleton.
4. Track 2: `BoxConfig.plugins`, `activePlugins`, `bbx plugins list`,
   agent-guide line, skill mirror. Depends on 3 for a real member.
5. Track 3: four health checks, `lintCards` dispatch; move node-refs lint
   into the plugin.
6. Track 5 remainder: concept-map view move, exposition compiler removal,
   templates removal, box-docs deletion, README, migration note.
7. Docs: `docs/plugins.md` authoring guide, `extensibility.md` revision,
   `docs/box/schemas.md:204` import list, `box-layout.md` mention.
8. Knowledge audits, run and recorded.
9. Cross-model review; CODING_FEEDBACK entry.

## Rollout shape

Tests first per chunk, named above. Done when: every doctest in "What will
hold this" passes, `pnpm typecheck`, `pnpm lint`, `pnpm layout-check` pass,
both knowledge audits run, and `bbx upgrade` of a test1 clone holding course
cards shows `plugin-cards-inactive` and then passes after the agent activates
courseware from the README. Migration is agent-by-hand from the README with
the health check as the prompt; no scripted data migration. Ships as one
merge when the boxholder says so.
