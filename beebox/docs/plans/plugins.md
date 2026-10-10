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
| Plugin registry, `definePlugin`, exports map, build and declaration pipeline, layout and import rules | 340 | 200 |
| `plugins` in box.json, `bbx plugins list`, agent-guide line, skill mirror with conflict refusal | 240 | 190 |
| Core health checks, `lintCards` dispatch with context | 220 | 200 |
| `extendSchema` helper | 110 | 100 |
| Upgrade: new-engine whole-box validate step | 40 | 40 |
| Courseware move (five schemas, skill, docs, lint): mostly moves | 600 | 200 |
| Concept-map view into the plugin: ViewProps adapter, CSS inlining, dependency move, frontend renderer removal | 450 | 120 |
| Drop exposition rules compiler; rewrite its instructions; legacy `rules` warning | 200 | 80 |
| **Total** | **2,200** | **1,130** |

Authored docs separately: `docs/plugins.md` authoring guide (~150 lines),
courseware README and SKILL.md (~120, mostly moved from `skills-content.ts`),
`extensibility.md` revision (~20).

**BIG CHANGE.** Source plus tests is about 3,300 changed lines. Approved by the boxholder 2026-10-10 with the two decisions below. About 600 of
that is courseware files moving with import rewrites, counted as deletions
plus additions. The boxholder agreed the direction and the first slice on
2026-10-09; this label asks for approval of the size. Slices 2 (scoped
Markdoc tags, the view-stub path with recipes and the concept-map view,
conventions enforcement) and 3 (connectors) are separate plans. Revised after
the cross-model review ([plugins.review.md](plugins.review.md)): the
harness-directory rename came out; the build pipeline, skill conflict
handling, and the upgrade validate step went in. The concept-map view move
came out and went back in on the boxholder's decision.

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
  (`src/dev/layout/check/rules.ts:12-17`, `src/dev/layout/model.ts:152-156`
  `LayoutRule`). `registry-location.ts:36-44` requires the registry module in
  the set directory's parent, named for the set.
- **Public build is explicit.** `src/scripts/build-cli/build/bundle.ts:44-52`
  bundles each public export (`cards`, `schema`, `server`) by name;
  `tsconfig.declarations.json` emits `.d.ts` only for
  `src/exports/cards.ts` and `src/exports/schema.ts`; `tsconfig.json:23` has
  `declaration: false`. A new export subpath ships only if both are extended.
- **Keep-last-good is in-process.** `src/schemas.ts:196-198` holds the
  last-good records in module-level maps; a fresh process has no prior record
  (`:375-379`). It covers an incomplete save, not a removed library.
- **Upgrade validates under the old engine**, before the bump
  (`upgrade.ts:264-268`); the pre-commit hook validates staged cards only
  (`validate/pre-commit.ts:69`). No step validates the whole box under the
  new engine.
- **Skills are written unconditionally** (`skills.ts:100-106`); the DOCID
  check guards pruning (`:115-119`), not installation.
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

Courseware today: `src/schemas/{course,lesson-plan,exposition-plan,progress,concept-map}.ts`
(each imports only `../exports/cards.js` and zod; `concept-map.ts` adds
`type LintIssue`), registered at `src/schemas.ts:74-77,125-131`;
`src/templates/courseware.ts` (registered at `src/templates.ts:35`);
`buildCourseSkill` at `guidance-sync/skills-content.ts:18` with
`FIGURE_EXAMPLES`; the concept-map renderer
(`src/frontend/src/renderers/concept-map.tsx`, `components/concept-map/*`),
which takes `RendererProps` (`ConceptMapView.tsx:18`), imports private UI
components and `@xyflow/react` with its CSS (`ConceptGraph.tsx:8-23`), and
stays in core in slice 1; the node-refs lint
(`src/core/card-lint/core/node-refs.ts:2-4`: *"Two courseware card types name
concept-map nodes by their `id`"*), which imports private containment helpers
(`node-refs.ts:35-36`) and finds the sibling map by the literal suffix
`.concept-map.card` (`:156`), dispatched by type at
`lint-cards.ts:287-292`; the exposition rules compiler
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
  the Claude Code and Codex plugins that install the validate hook. The
  directory keeps its name; the docs say "harness plugin" for these and
  "plugin" for the new kind. The paths do not collide.

New names:

- **Plugin**: a directory `src/plugins/<name>/` in the engine, exported as
  `beebox/plugins/<name>` (Node) and, when it has one, `beebox/plugins/<name>/view`
  (browser), whose `index.ts` default-exports a `PluginDefinition`.
  Identified by `name`, kebab-case, equal to the directory. It is NOT a box
  file and NOT a runtime registration; it is a library. Points at: bases, an
  optional view module, a skill text, docs, hooks. The registry module is
  `src/plugins.ts`; the contract lives in `src/shared/plugin-definition.ts`,
  outside the member directory, as the layout rules require.
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
  `healthChecks(boxRoot)`, `lintCards(input, ctx)`. NOT an event
  subscription. `ctx` is a `LintContext` the engine passes in, so a plugin
  never imports engine internals for box-aware work.
- **Effective schemas**: the map `createCardSchemaMap(boxRoot)` returns
  (`schemas.ts:434`): built-ins plus the box's loaded stubs. Health is
  computed from this, never from the active list alone.
- **Tier**: instruction, trick, plugin. A vocabulary for the authoring
  guide, not a code concept.

```ts
// src/shared/plugin-definition.ts (re-exported by each beebox/plugins/<name>)
export interface LintContext {
  readonly boxRoot: string;
  readonly resolveContainedRef: (from: string, ref: string) => Promise<string | null>; // wraps src/core/ref-exists.ts
  readonly listSiblingCards: (dir: string) => Promise<string[]>;                       // contained readdir
}
export interface PluginDefinition {
  readonly name: string;                 // equals directory name
  readonly description: string;          // one line; passes the brief lint
  readonly docs: string;                 // path under the package, e.g. "src/plugins/courseware/README.md"
  readonly skill?: string;               // SKILL.md body; engine writes frontmatter
  readonly schemas?: Readonly<Record<string, CardSchemaConfig<string, Record<string, FieldDecl>>>>; // key = default type
  readonly views?: ReadonlyArray<{ readonly name: string; readonly rendersCardTypes: ReadonlyArray<string> }>; // none in slice 1
  readonly healthChecks?: (boxRoot: string) => Promise<HealthCheck[]>;
  readonly lintCards?: (input: { path: string; type: string; fields: Record<string, unknown> }, ctx: LintContext) => Promise<LintIssue[]>;
}
export function definePlugin(def: PluginDefinition): PluginDefinition;
```

No `scripts` field: no slice-1 plugin ships a script; add it with the first
one that does.

## Tracks / scope

### Track 1: plugin registry and boundary

**What.** `src/plugins/` with a `defineRegistry` of plugin definitions,
`definePlugin`, the exports-map entries, and the enforced import boundary.

**Why.** Without a registry the engine cannot list plugins or read their
declarations. Without the boundary an in-repo plugin is core by another
name.

**Direction.**

- `src/plugins.ts`: `export const plugins = defineRegistry<PluginDefinition>({ directory: "./plugins", entry: "index", ordered: false, members: { courseware } })`.
  This satisfies `registry-location.ts:36-44` (registry in the set's parent,
  named for the set) and `set-members`; the contract file is in `src/shared/`.
- `package.json` `exports` adds `"./plugins/*": { types: "./dist/plugins/*/index.d.ts", default: "./dist/plugins/*/index.js" }`
  and `"./plugins/*/view": { types: "./dist/plugins/*/view.d.ts", default: "./dist/plugins/*/view.js" }`.
  Two entries because `index.ts` may import `node:fs` for health checks and
  `view.tsx` must stay browser-safe; the view compiler bundles whatever the
  stub imports (`compile.ts:206`). No slice-1 plugin has a `view.tsx`; the
  entry is declared now so the contract is complete.
- **Build pipeline.** `bundle.ts:44-52` gains one bundle per registry member
  for `index.ts` (zod and yaml external, like `cards`), and
  `tsconfig.declarations.json` `files` gains `src/plugins/*/index.ts` and
  `src/shared/plugin-definition.ts`. Without both, the export map advertises
  files `build:cli` does not emit.
- `files` adds `src/plugins/*/README.md` so docs are readable at
  `node_modules/beebox/src/plugins/<name>/README.md`, the way box agents read
  `node_modules/beebox/box-docs` today.
- Boundary: a new layout rule `plugin-imports` in `src/dev/layout/check/rules/`
  (registered at `rules.ts:12-17`): a file under `src/plugins/<name>/` may
  import only `src/exports/*`, `src/shared/plugin-definition.ts`, its own
  directory, and external packages; a `view.tsx` may not import `node:*`.
  Mirrored as an `eslint.config.ts`
  `@typescript-eslint/no-restricted-imports` block for `src/plugins/**`
  (pattern of `:162-183`) so the editor shows it.

**Vocabulary lock-ins.** `beebox/plugins/<name>`, `beebox/plugins/<name>/view`,
`PluginDefinition`, `LintContext`, `definePlugin`,
`src/plugins/<name>/{index.ts,README.md,SKILL.md}`, `src/plugins.ts`.

**First chunk.** Add `src/shared/plugin-definition.ts`, `src/plugins.ts` with
an empty members object, the exports entries, the bundle and declaration
entries, the layout rule and lint block. Doctests: a fixture plugin
importing `src/core/...` fails the layout rule; a packaged install (the
tarball path `BBX_INIT_BEEBOX_SPEC` already used by smoke tests, not
`makeTmpBox({deps:true})`, which links the checkout per
`doctest-helpers.ts:65`) resolves `beebox/plugins/<fixture>` and typechecks a
stub against it.

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
  for each with a `skill`. Two changes to `generateSkills`, because today it
  writes unconditionally (`:100-106`): before writing, if the destination
  `SKILL.md` exists and is not DOCID-marked, do not write; report a
  `skill-name-conflict` health warning naming both files. On retirement of a
  plugin skill, remove only marked files in its directory and leave unmarked
  extras in place (the directory stays if anything remains). Deactivation
  then removes exactly what the engine wrote.

**Vocabulary lock-ins.** `plugins` key in box.json; verb `bbx plugins list`;
skill name equals plugin name.

**First chunk.** `BoxConfig.plugins` with validation, `activePlugins`,
`bbx plugins list`, a doctest with a fixture plugin.

### Track 3: health and lint hooks

**What.** Four core checks plus the two enumerated hooks.

**Why.** Boxholder: deactivation, rot and removal "can't brick the box or go
without being noticed".

**Direction.** The checks are computed from three inputs: the effective
schema map (`createCardSchemaMap(boxRoot)`, `schemas.ts:434`), the card types
present on disk, and the active list with each active plugin's declarations.
The active list alone decides nothing. In `runHealthChecks` after
`templateUpdatesCheck` (`:224`):

- `plugin-type-unprovided`: a card type present on disk has no effective
  schema, and some plugin (active or not) declares it as a default type key.
  Message: *"N cards of type course have no schema. The courseware plugin
  provides it: `bbx plugins list`, then its README."* Error. This covers both
  the inactive plugin and the active plugin with a missing stub.
- `plugin-declared-missing`: an active plugin declares a default type with
  no effective schema of that name, or (later) a view with no stub. Message
  names the plugin, the type, and the README's Setup section. Error. Two
  checks because the first has cards at risk and the second may not.
- `plugin-stub-inactive`: a box schema, view or trick file imports
  `beebox/plugins/<name>` and `<name>` is not active. Warning. Detection is a
  regex over static import specifiers in `src/schemas/*.ts`,
  `src/views/*.tsx`, `src/tricks/scripts/*/index.ts`, the same approach as
  `readDescription` (`trick.ts:59-65`); the README says stubs use static
  imports.
- `plugin-stub-missing`: a stub imports `beebox/plugins/<name>` and the name
  is not a registry key, or the box schema loader reported a load failure for
  that stub (`schemas.ts:375-379` already logs it; this check surfaces the
  same record). Error.
- `skill-name-conflict`: from Track 2.
- `legacy-exposition-rules`: from Track 5.
- `plugin-checks`: for each active plugin with `healthChecks`, append its
  results with `name` prefixed `<plugin>/`; a thrown error becomes one
  failing check `<plugin>/checks`.

Box typecheck failing is surfaced by `bbx upgrade` (`upgrade.ts:21-23`) and
`bbx view typecheck`; no new check.

`lintCards`: `lint-cards.ts:287-292` replaces its three type-specific
branches with a loop over active plugins' `lintCards`, called for every
card whose type has an effective schema, passing a `LintContext` built from
`src/core/ref-exists.ts` and the containment helpers. Schema `validate` stays
self-contained (`schema.ts:240` comment: *"generic, box-aware checks ... stay
in the host's lint dispatch"*); `lintCards` is that dispatch, now pluggable.
The `figure` branch beside them stays.

**Upgrade.** `bbx upgrade` gains one step after `engine migrate` and before
the commit: `newBbxBin validate` over the whole box, so cards made invalid
by a base change are listed by file under the new engine. Whether failures
block the commit or are reported and left for the agent is an open
question below; the step exists either way.

**Vocabulary lock-ins.** Check names above; hook names `healthChecks`,
`lintCards`; `LintContext`; the `<plugin>/` prefix.

**First chunk.** `plugin-type-unprovided` and `plugin-declared-missing` as
one pure function over (types on disk, effective schema names, registry,
active list) with a doctest for each cell: inactive plugin with cards,
active plugin with no stub and cards, active plugin with no stub and no
cards, stub present. Then the file-scanning checks.

### Track 4: `extendSchema` and exported bases

**What.** A helper that composes a base with a delta, and the courseware
bases exported from the plugin.

**Why.** Spread replaces `validate` and `summarize`; the boxholder wants
"basically subclass".

**Direction.** In `src/cards/schema.ts`, exported through `beebox/cards`:

```ts
export interface SchemaDelta<F extends Record<string, FieldDecl>> {
  readonly fields?: F;                       // added fields; a key already in the base is a type error
  readonly validate?: (input: CardValidateInput) => LintIssue[];
  readonly superRefine?: CardSchemaConfig["superRefine"];
  readonly summarize?: CardSchemaConfig["summarize"];
  readonly instructions?: string;
  readonly description?: string; readonly brief?: string; readonly prominence?: ProminenceLevel; readonly theme?: ThemeChoice;
}
export function extendSchema<
  BF extends Record<string, FieldDecl>, DF extends Record<string, FieldDecl>,
>(base: CardSchemaConfig<string, BF>, delta: SchemaDelta<DF>): CardSchemaConfig<string, BF & DF>;
```

The delta is typed on its own, not as `Partial<base>`, so
`extendSchema(progressBase, { fields: { mood: z.string().optional() } })`
adds one field without restating the base's and the merged `fields` type is
inferred for `summarize` and `InferCardFields`. Rules: `fields` merge by key
and a key present in both is rejected at the type level (an override that
changes a field's type would invalidate the base's callbacks); `validate`
runs base then delta and concatenates; `superRefine` (`schema.ts:252`, a
parse-time invariant) runs both, base first, so a base invariant cannot be
dropped by extension; `summarize` runs delta with the base's result as
`base`; `instructions` concatenates with a blank line; the scalar options are
delta wins. Exporting the built-in configs of core types (`doc`, `memo`, ...)
is NOT in slice 1; only plugin bases are exported.

**First chunk.** `extendSchema` with a doctest per rule, including: adding
`mood` to the progress base keeps `summarize` typed; a duplicate field key
fails `tsc`; a card violating the base's `superRefine` still fails to load
after extension.

### Track 5: courseware onto the mechanism

**What.** Move `course`, `lesson-plan`, `exposition-plan`, `progress`,
`concept-map`, the concept-map view, the build-course skill, the node-refs
lint, and the templates into `src/plugins/courseware/`. Drop the exposition
rules compiler.

**Why.** Courseware is content a box is about, not medium; it exercises every
part of the mechanism: schemas, a view, a skill, docs, a lint hook.
**DECIDED (boxholder, 2026-10-10):** the concept-map view moves in slice 1.
Its renderer takes `RendererProps`, imports private UI primitives and
`@xyflow/react` with its stylesheet, and the view compiler has no CSS path,
so the move is an adapter and a packaging change:

- `src/plugins/courseware/view.tsx` exports a `ViewProps` component. It
  reads the anchor concept-map card from `ViewProps`, renders the body with
  the `Markdown` widget, and replaces the private `Text`, `Card`, `Hint` and
  `cn` imports with plain elements and its own class names. `ViewProps` is
  exported as a type from `beebox/view-widgets` (add to
  `src/exports/view-widgets.d.ts` and the ambient twin).
- CSS: the plugin view bundle inlines imported stylesheets as a
  `<style>` element appended once at module load (an esbuild loader plugin
  in `bundle.ts`), so the stub's compiled module is self-contained and the
  view compiler needs no CSS path.
- Dependencies: `@xyflow/react` and `dagre` move from
  `src/frontend/package.json` to `beebox/package.json` devDependencies; they
  are bundled into `dist/plugins/courseware/view.js` at build time with
  `react` and `beebox/view-widgets` external, like the view-widgets bundle.
  The frontend bundle loses React Flow.
- The box stub is `src/views/concept-map.tsx`: re-export the plugin view as
  default, `export const rendersCardTypes = ["concept-map"]`.

**Direction.**

- `index.ts`: `definePlugin({ name: "courseware", description: "Courses, lesson plans, learner progress", docs: "src/plugins/courseware/README.md", skill: BUILD_COURSE_SKILL, schemas: { course: courseBase, "lesson-plan": lessonPlanBase, "exposition-plan": expositionPlanBase, progress: progressBase, "concept-map": conceptMapBase }, lintCards })`.
- Remove the five registrations from `src/schemas.ts:74-77,125-131` and the
  imports in `src/core/system-cards.ts` are untouched (inventory stays).
- Remove the built-in renderer (`renderers/concept-map.tsx`, its entry in
  `renderers.ts`, `components/concept-map/*`). A box without the view stub
  gets the Card and Source renderers for concept-map cards; the README's
  Setup lists the view stub.
- `exposition-plan` keeps its `rules` field so existing cards validate. Its
  `instructions` (`exposition-plan.ts:66-70`, *"compiled output"*) and the
  skill text (`skills-content.ts:79`, *"compiled into a box rule that
  auto-loads"*) are rewritten in the move: the plan's rules go in a nested
  `AGENTS.md` in the course directory; the field is legacy. A new health
  check `legacy-exposition-rules` warns for every exposition-plan card with
  a nonempty `rules` until the agent moves them, with the README's Migration
  section as the instruction. The field is removed in a later release once
  no test box reports the warning.
- Remove `compile-exposition-rules.ts`, its call sites
  (`refresh-derived-rules.ts:18`, `docs-gen/generate/core.ts:450-451`), the
  surface at `guidance-surfaces.ts:107`, and the doctest. Generated
  `.claude/rules/exposition-*.md` files are DOCID-marked; `generateDocs`
  gains a cleanup that deletes marked files matching that family, kept
  indefinitely (it is one glob), since the surface registry has no
  prune-only class (`guidance-sync/core.ts:94-100` skips owner rows).
- `src/templates.ts:35` drops `courseware`; the README shows the frontmatter
  instead. Lock-in: no `templates` hook.
- `box-docs/card-{course,exposition-plan,concept-map}.md` deleted; the
  generated box-local docs replace them when a stub exists.
- README sections: What it is, Setup (the exact stubs), Conventions (default
  type names are assumed by the node-refs lint and by `course` refs; renaming
  is allowed for display but disables those checks), Migration (from engine
  ≤ this version: activate, write stubs, move `rules` to `AGENTS.md`),
  Uninstall.
- The node-refs lint becomes the plugin's `lintCards`, using
  `ctx.resolveContainedRef` and `ctx.listSiblingCards` in place of
  `src/core/ref-exists.ts` and `lib/box-containment.ts`; the `.concept-map.card`
  suffix stays as the documented convention.
- No `MIGRATIONS` entry. Activation is prompted by `plugin-type-unprovided`
  and `legacy-exposition-rules`, computed from cards, with the README as the
  repair instruction.

**Vocabulary lock-ins.** Plugin name `courseware`; default type names
unchanged; stub file names `src/schemas/<type>.ts`, `src/views/concept-map.tsx`;
check name `legacy-exposition-rules`.

**First chunk.** Move the five schema configs to bases and the plugin
`index.ts`; rewrite the exposition instructions and skill text;
`test/schemas.doctest.md` courseware cases move to the plugin's doctest,
which writes the README's stubs into a `makeTmpBox` and runs `bbx validate`.

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
caller, and the README covers it), no `scripts` declaration (no slice-1
plugin ships a script), no scoped tags (slice 2, no consumer in courseware),
no `bbx plugins
activate` verb (the agent edits box.json and writes stubs from the README; a
verb would hide which stubs were written), no per-plugin version (versioned
with the engine), no migration ledger entry (the health checks compute the
prompt from cards; a procedure migration would execute under `bbx upgrade`,
`migrate.ts:94`, against the manual-migration decision), no renaming of the
harness `plugins/` directory (the paths do not collide), no connectors hook
(slice 3).

## Subplans

- [plugins.design.md](plugins.design.md): the person-facing parts.
- Slice 2 and slice 3 are future plans, not subplans; they ship separately.

## Failure modes

> **Critical gap (resolved in plan):** the export map advertises
> `beebox/plugins/<name>` but `build:cli` and the declarations config emit
> only the named exports (`bundle.ts:44-52`, `tsconfig.declarations.json`).
> A dev checkout masks this because the box links the source tree. Fix: the
> build and declaration entries in Track 1 and a packaged-install doctest.

> **Critical gap (resolved in plan):** an active plugin with no stub and
> cards on disk produced no signal under the first draft's checks. Fix: the
> checks are computed from effective schemas (`plugin-type-unprovided`,
> `plugin-declared-missing`).

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Stub imports `beebox/plugins/x` after `x` leaves the registry; process restarts | new doctest | keep-last-good is in-process only (`schemas.ts:196,375`), so the type is gone; the loader logs the failure; `plugin-stub-missing` surfaces it; `bbx upgrade` typecheck fails before the commit if the removal arrives by upgrade | clear: status, health, upgrade |
| Box lists a plugin name that does not exist, or `plugins` is not an array | new doctest | explicit validation in the config reader (`config.ts:391` delegates to readers; `loadAgentEngine` at `:207` is the pattern); the bad entry is ignored and reported, the rest load | clear: `bbx status`, health |
| Course cards exist, plugin inactive, no stub | new doctest | `plugin-type-unprovided` | clear |
| Course cards exist, plugin active, no stub | new doctest | `plugin-type-unprovided` and `plugin-declared-missing` | clear |
| Plugin active, no stub, no cards | new doctest | `plugin-declared-missing` | clear |
| Stub exists, plugin deactivated | new doctest | `plugin-stub-inactive`; the chat summary names the lost skill and lint | clear |
| Base adds a required field in a later engine; cards on disk lack it | new upgrade doctest | new-engine whole-box validate step in upgrade; `bbx validate` and health afterwards | clear per card; block-or-report is open |
| Base renames a field the stub's delta references | upgrade typecheck (`upgrade.ts:21-23`) | upgrade fails before commit; `git reset --hard` | clear |
| Two active plugins export the same default type key | new doctest | registry check at load: duplicate keys are an invariant failure | clear, fails hard (dev) |
| Plugin `healthChecks` throws | new doctest | caught per plugin; one failing check `<plugin>/checks` | clear |
| Plugin `lintCards` throws on one card | new doctest | caught per card; a warning issue names the plugin | clear |
| Box already owns an unmarked `courseware/SKILL.md` when the plugin activates | new doctest | write refused; `skill-name-conflict` warning; retirement removes marked files only | clear |
| `exposition-plan.rules` populated after the compiler is gone | new doctest | `legacy-exposition-rules` warning per card; rewritten instructions stop new ones | clear via health |
| Old `exposition-*.md` rule files linger | new doctest | marked-file cleanup in `generateDocs`, kept across releases | clear |
| Box renames `concept-map` and expects the node-refs lint | README | documented convention; lint finds no map and reports nothing | silent by design; documented |
| Plugin `view.tsx` imports a Node built-in or an engine internal | layout doctest | `plugin-imports` rule forbids it; the browser-target bundle in `bundle.ts` fails on `node:*` | clear at build |
| Stylesheet injected twice when two views import the same plugin | new doctest | the inliner guards on a data attribute per stylesheet hash | clear |
| Concept-map card with no view stub | README | Card and Source renderers show the card; `plugin-declared-missing` names the view | clear |
| Import regex misses a dynamic import in a stub | new doctest | documented: stubs use static imports (README) | silent for exotic stubs; accepted |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field.** ADDRESSED: default type keys are the only
  names a stub needs; the README shows the stub verbatim.
- **Stale ref.** DEFERRED: the node-refs lint moves unchanged; a stale
  concept-map ref is reported as today.
- **Two agents touching the same card.** ADDRESSED: `box.json` edits go
  through the existing config write path; stubs are new files.
- **Hand-edit drift.** ADDRESSED: a stub with the wrong type name is a box
  schema like any other; `plugin-type-unprovided` catches cards of a default
  type the box did not define, and `plugin-declared-missing` catches the
  active plugin whose default type has no stub.
- **Fabricated free-form value.** ADDRESSED: `plugins` entries must be
  registry keys.
- **Validation error UX.** ADDRESSED: messages name the plugin and the
  command to run; checked in the design subplan.
- **Partial migration.** ADDRESSED: an upgraded box with course cards and no
  activation is a visible health error until the agent acts; a populated
  `exposition-plan.rules` is a warning per card until moved; the field is
  removed only after the warning is quiet on the test boxes.
- **Agent writes a stub without listing the plugin.** ADDRESSED: cards
  validate (the stub defines the type), the skill is absent, lint hooks do
  not run, health warns `plugin-stub-inactive`.
- **Agent lists the plugin and writes no stub.** ADDRESSED:
  `plugin-declared-missing`, plus `plugin-type-unprovided` when cards exist.
- **Agent follows old exposition instructions and writes `rules`.**
  ADDRESSED: the instructions and skill are rewritten in the move, and the
  warning fires on the new card.

## NOT in scope

- Scoped Markdoc tags on the schema (`markdocTags`) and the `Markdown` widget
  accepting tag components: slice 2, when recipes move.
- Connectors as plugins, Gmail and Drive, a generic calendar type: slice 3.
- Exporting core built-in configs as bases: when a box needs to extend one.
- Renamed-type support for cross-card lints (a mapping from a box type name
  to the base it came from): a boxholder decision if a box ever needs it.
- Renaming the harness `plugins/` directory: no path collision.
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

- **DECIDED (boxholder, 2026-10-10):** the concept-map view moves into the
  plugin in slice 1 (Track 5).
- **DECIDED (boxholder, 2026-10-10):** the new-engine whole-box validate in
  `bbx upgrade` reports failures and the upgrade finishes; it never blocks
  on card validity. The health checks keep the failures visible.
- Whether `bbx plugins list` should also print the active plugins' stub
  status (which README stubs exist). Lean: yes, it is the agent's
  declared-versus-present view and costs one glob per plugin.
- When the `exposition-plan.rules` field is removed. Lean: the release after
  the test boxes report no `legacy-exposition-rules` warning.

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
  validation; `bbx plugins list` output; each health check, with the
  type-coverage check as a pure function over (types on disk, effective
  schema names, registry, active list); `extendSchema` merge rules; skill
  conflict refusal and marked-only retirement; the courseware plugin's own
  setup doctest, which writes the README's stubs into a temp box and runs
  `bbx validate`. The README stubs are the fixture, so the docs cannot drift
  from what compiles.
- A packaged-install doctest (tarball spec) that imports
  `beebox/plugins/courseware` and typechecks a stub, so the export map and
  the build cannot drift apart.
- Layout check and lint in pre-commit hold the import boundary.
- No new test tier. No mocks beyond the existing temp box.
- The decision "which plugin provides this unknown type" is a pure function
  over (card types on disk, registry, active list) and is doctested
  directly.

## Implementation order

1. Track 1 first chunk: `src/shared/plugin-definition.ts`, `src/plugins.ts`
   with an empty registry, exports entries, bundle and declaration entries,
   layout rule, lint block, the layout doctest and the packaged-install
   doctest against a fixture plugin.
2. Track 4: `extendSchema` and doctests.
3. Track 5 first chunk: courseware bases and `index.ts` with rewritten
   exposition instructions and skill text; register in the registry; remove
   the `schemas.ts` registrations; plugin doctest writing the README stubs.
4. Track 2: `BoxConfig.plugins` validation, `activePlugins`, `bbx plugins
   list`, agent-guide line, skill mirror with conflict refusal and
   marked-only retirement. Depends on 3 for a real member.
5. Track 3: the pure check function and its doctests; the file-scanning
   checks; `lintCards` dispatch with `LintContext`; node-refs lint into the
   plugin; `legacy-exposition-rules`; the upgrade validate step.
6. Track 5 remainder: exposition compiler removal and marked-file cleanup,
   templates removal, box-docs deletion, README.
7. Docs: `docs/plugins.md` authoring guide, `extensibility.md` revision,
   `docs/box/schemas.md:204` import list, `box-layout.md` mention.
8. Knowledge audits, run and recorded.
9. Cross-model review round 2 on the diff; CODING_FEEDBACK entries.

## Rollout shape

Tests first per chunk, named above. Done when: every doctest in "What will
hold this" passes, `pnpm typecheck`, `pnpm lint`, `pnpm layout-check` pass,
both knowledge audits run, and `bbx upgrade` of a test1 clone holding course
cards shows `plugin-type-unprovided` and `legacy-exposition-rules`, then
passes after the agent activates courseware from the README and moves the
rules. Migration is agent-by-hand from the README with the health checks as
the prompt; no ledger entry. Ships as one merge when the boxholder says so.
