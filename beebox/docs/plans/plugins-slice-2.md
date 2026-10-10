---
title: "Plugins slice 2: scoped Markdoc tags, recipes as a plugin, conventions"
status: draft
workstream: plugins-planning
issues: []
---
# Plugins slice 2: scoped Markdoc tags, recipes as a plugin, conventions

Slice 1 ([plugins.md](../implemented-plans/plugins.md)) made a plugin a typed
library a box completes through stubs, and moved courseware into one. This
slice gives a card type its own Markdoc tags, moves the recipe type and its
six tags into a `recipe` plugin as the first consumer, and turns the
"Conventions" list in `docs/plugins.md` into rules a doctest enforces.

**Issues addressed:** none filed. Grepped `issues/` (not `closed/`,
not `private-issues/`) for recipe, markdoc, plugin, conventions: the nearest
items are `issues/features/2026-08-19-collection-views-are-badly-defined.md`
(wants a recipe index view; untouched here) and
`issues/exploration/2026-05-11-canonical-wisdom-corpus.md` (the standing
"knowledge, not plugins" position; `docs/plugins.md` already reconciles it).

## Design

No design section: the person meets the same recipe card, the same scale
control and the same rendered tags. What changes is where the code lives and
that a recipe tag in a memo now gets a warning instead of a silent render.
The one person-visible change is that a box with recipe cards and no active
plugin shows them through the generic card view until the agent activates
the plugin (Migration, below); `plugin-type-unprovided` names the step.

## Smallest fix and budget

**Smallest fix:** move only the recipe schema and view into a plugin and
leave the six recipe tags in the core table, as `docs/plugins.md` says today
("until then, tags stay in the core table"). About 900 changed lines. It
leaves a `{% yield %}` valid in every card body and leaves every future
plugin's tags in `src/shared/markdoc-config/tags/core.ts:463`, which the
slice 1 discussion decided against ("tags are local to the type", design
notes "Markdoc tags", **DECIDED**).

**Chosen design, three tracks:**

| Track | Source | Tests | Docs |
|---|---|---|---|
| 1 Scoped tags in the engine, with the `unknown-tag` fallback | ~170 | ~130 | ~40 |
| 2 Recipes as a plugin (delete core ~715, add plugin ~650) | ~1,365 | ~160 | ~130 |
| 3 Conventions guide and its doctest | ~10 | ~80 | ~60 |
| **Total** | **~1,545** | **~370** | **~230** |

About 2,150 changed lines in all (additions plus deletions), of which ~715 are
deletions of core recipe code. **BIG CHANGE**, by a small margin, and slice 1
ran 2.2× its estimate. **Approved by the boxholder 2026-10-10** ("Yes,
proceed"), with the `unknown-tag` fallback presentation ("Show the authored
tag") approved the same day. Scoping the four built-in tags is under
discussion; this slice leaves them global. What drives it: the recipe view and its seven tag
components (394 lines today) move across a boundary that forbids their current
imports, so they are rewritten against `beebox/view-widgets` rather than
copied. Generated output: `dist/plugins/recipe/*` (not committed).

## Stated preferences this plan trades against

- Boxholder decision (design notes, "Markdoc tags"): tags local to the type;
  the global table shrinks to the core vocabulary. This plan moves the six
  recipe tags and leaves briefing's `purpose`/`correction` and
  capture-session's `image`/`silence` in the core table. Reason under
  *NOT in scope*: scoping a built-in type's tags needs the generic card page
  to know a type's tags, a client-side lookup with no plugin consumer.
- Boxholder decision: "every plugin has a doctest that writes its README's
  stubs into a temp box" (`docs/plugins.md`, Conventions). Track 3 makes
  one doctest enumerate all plugins instead of trusting each plugin to carry
  its own; principle 11 ("Enforcement beats convention").
- Principle 8 ("One way to do each thing"): the recipe view's own body
  rendering goes through the `Markdown` widget with two new props rather
  than a recipe-specific renderer path. The `components` prop already exists
  (`body.tsx:296`); `tags` is its pair.
- Principle 4 ("never silent"): a scoped tag used outside its type must
  warn. Markdoc already reports it (`tag-undefined`, level `critical`,
  `node_modules/@markdoc/markdoc/dist/index.js:8537`), and
  `lintBodyMarkdoc` already keeps critical-level entries, so shrinking the
  core table makes the warning appear with no new code.
- Memory "Stop over-engineering rare failures": the plugin view bundles its
  own Markdoc copy rather than adding a host-module shim. *Could this be
  simpler?* has the trace.
- Shipped precedent: the courseware move (`src/plugins/courseware/`,
  `test/plugins/courseware/`), copied file for file where it fits.

## What already exists

Reuse unless marked:

- Tag table: `src/shared/markdoc-config/tags/core.ts:463`
  `export const markdocConfig: Config = {` with the six recipe tags at
  :469-474 and their schemas at :237-297. Every consumer imports the value.
- Body validation: `src/core/body-markdoc-lint.ts:41`
  `export function lintBodyMarkdoc(bodyText: string): LintIssue[]`, called
  from `src/core/card-lint/core/lint-cards.ts:275-276`:
  `if (parsed.schema.ownMarkdocValidation !== true && typeof bodyField === "string") { warnings.push(...lintBodyMarkdoc(bodyField));`.
  The caller has `parsed.schema` in hand; the lint does not take it.
- Markdoc with no schema for a tag: validation emits `Undefined tag:
  '<name>'` at level `critical` (`dist/index.js:8533-8539`); transform
  renders the tag's children and drops the tag and its attributes
  (`dist/index.js:7031-7036`: `const schema = this.findSchema(node2, config) ?? {}; ... if (!schema || !schema.render) return children;`).
  So `{% ingredient amount="2" unit="cups" %}flour{% /ingredient %}` on a
  surface without the recipe tags shows only "flour". Track 1 adds the
  fallback that keeps the attributes visible.
- The generic card page renders a body with no type knowledge:
  `src/frontend/src/components/MarkdownCardView/CardBody.tsx:110` calls
  `<Markdown prose="block" ... components={components}>` with the core
  table only.
- Markdoc `Tag` identity is a string check, `tag?.$$mdtype === "Tag"`
  (`dist/index.js:6814-6815`), so a `Tag` built by a second Markdoc copy
  renders in the host.
- The Markdown widget: `src/frontend/src/components/Markdown/body.tsx:164`
  `buildRenderConfig` spreads `markdocConfig` into a per-render config
  (:164-167); the component map is one object (:254); the `components`
  prop merges per call (:296, :340-343); the widget receives `card.path`
  and never the type (:313).
- The widget as a box view sees it: `src/exports/view-widgets.d.ts:36`
  `export const Markdown: ComponentType<{ children: string; card: {...} }>`
  with its engine-internal twin `src/types/view-widgets.d.ts:29` and the
  runtime wrapper `src/frontend/src/components/view-widgets/ViewMarkdown.tsx:29`.
- Recipe tag components: `src/frontend/src/components/RecipeTags.tsx:123`
  `makeRecipeComponents`, scale via `RecipeScaleContext` (:34), link via
  `linkCtx.onNavigate` (:247). The view: `RecipeView.tsx` (109 lines),
  registered at `src/frontend/src/renderers/recipe.tsx:12` and
  `renderers.ts:65`; CSS at `src/frontend/src/index.css:35-49`.
- Recipe schema and template: `src/schemas/recipe.tsx:34`
  `RecipeSchema = cardSchema("recipe", {...})`, instructions :46-110,
  `createRecipeTemplate` :117; registered `src/schemas.ts:40,108`; template
  `src/templates/builtins/templates.ts:78-95`.
- Box-local templates: a schema module exports `template`
  (`docs/box/schemas.md:236-262`); the loader reads it at
  `src/schemas.ts:356-358` (`const rawTemplate: unknown = mod.template; ...
  if (template) registerBoxTemplate(template, boxRoot);`). A stub can
  re-export one.
- Emitter: `src/core/markdoc/emit-tags.ts:69-80` tries universal, briefing,
  recipe, markup groups, then `console.warn(... unknown tag ...)` and emits
  inner content. Its only caller is `compileBriefing`
  (`src/schemas/briefing.tsx:25`).
- Todo extraction validates against the core config but keeps only errors
  attributed to `todo`/`see-also` (`src/core/todo/extract/body.ts:85-91`).
  Unaffected by a shrunken table.
- Publish lowering throws on any capitalized tag but `Task`
  (`src/publish/prepare/core/markdown.ts:50-57`). Recipe tags fail there
  today; unchanged.
- Plugin build: `src/scripts/build-cli/build/plugins.ts:45-56`
  `listPluginEntries` picks up any `src/plugins/<name>/{plugin.ts,view.tsx}`;
  the view bundle externalizes only React, `react-dom` and
  `beebox/view-widgets` (:212, :237) and inlines CSS imports
  (`cssInlinePlugin`). A `recipe` directory needs no build change.
- The view compiler restricts a view's imports to React and
  `beebox/view-widgets` (`src/webapp/views/compiler/compile.ts:149`:
  `"... is not available to a view; views import react, react/jsx-runtime, react-dom and react-dom/client"`). The plugin view bundle is built before
  that step, so its own dependencies are already inlined.
- Coverage and health for a plugin's types and views:
  `src/core/plugins/coverage.ts`, checks in
  `src/webapp/trpc/routers/health/checks/plugins/`. `plugin-type-unprovided`
  fires for `*.recipe.card` files once `recipe` leaves `src/schemas.ts`.
- Box docs for a stubbed type: `src/core/docs-gen/box-docs.ts:38-46` writes
  `card-<type>.md` from a box-local schema's `instructions`, so
  `node_modules/beebox/box-docs/card-recipe.md` keeps existing in a box
  with the stub, which the three `recipe-*` knowledge audits read
  (`src/dev/knowledge-audits.yaml:5225-5301`).
- `extendSchema(base, delta)` (`src/cards/extend-schema.ts`) composes
  fields with duplicate rejection and concatenates `instructions` (:146).
- Registry doctest `test/plugins.doctest.md` enumerates `pluginNames()`.
- Courseware setup doctest `test/plugins/courseware/plugin.setup.doctest.md:69-82`
  reads the README's stub code blocks (`readmeStubs()`) and writes them into
  a temp box. **Rebuild as a shared helper**: Track 3 needs it for every
  plugin.

## Prior art (external)

- Markdoc config is per call: `validate(ast, config)` and
  `transform(ast, config)` take the tag table as an argument, so a per-type
  table is a config object, not a registry. Verified in
  `node_modules/@markdoc/markdoc/dist/index.js` (`validator`, `node`). Adopted
  as the mechanism; it is the library's own API, no acknowledgement entry.
- Markdoc has no notion of a tag scope or namespace; its docs recommend one
  config per document kind (https://markdoc.dev/docs/config). Evaluated-only.
- No other decision here rests on an external premise.

## Ontology

Existing names, used as the code spells them:

- **Core tag table**: `markdocConfig.tags` (`tags/core.ts:464`). After this
  plan: the tags valid in every card body. Loses the six recipe tags.
- **Tag schema**: Markdoc's `Schema` (`attributes`, `validate`, `transform`).
- **Render name**: the string a transform passes to `new Tag(name, ...)`,
  the key the widget's component map is looked up by (`body.tsx:254`).
- **Base**, **stub**, **active**, **effective schemas**: as in
  `docs/plugins.md` Vocabulary.
- **Plugin view**: `src/plugins/<name>/view.tsx`, re-exported by a view
  stub with `rendersCardTypes` (`docs/plugins.md`, Stubs).

New:

- **Scoped tags** (`markdocTags`): an optional field on `CardSchemaConfig`,
  `Readonly<Record<string, Schema>>`, keyed by authored tag name. Valid in
  this type's body in addition to the core table. Identified by the type that
  carries them. NOT global; NOT inherited by other types; NOT a registry. A
  key that is also in the core table is a load-time error
  (`RedeclaredTagError`, mirroring `RedeclaredFieldError`). Carried through
  `extendSchema`: a delta may add tags; it may not redeclare the base's.
- **Tag components**: the render-name → React component map a view hands
  the widget through the existing `components` prop. One per render name.
  Browser code; lives beside the view.
- **Recipe plugin**: `src/plugins/recipe/`, one base (`recipe`) carrying six
  scoped tags, one view (`recipe`), one template, no skill (the base's
  `instructions` carry the vocabulary, as today), no lint, no health hook.

Two names for one thing avoided: the tag's authored name (`ingredient`) is
the `markdocTags` key; the render name (`IngredientInline`) is the component
key. Both already exist in the code with these roles.

## Tracks / scope

### Track 1: scoped tags in the engine

**What.** `CardSchemaConfig.markdocTags`; validation and the widget merge a
type's tags over the core table; the view-widgets `Markdown` surface gains
`tags` and `components`.

**Why.** Today a type's tags can only live in the global table
(`tags/core.ts:70` "Add new tags here"), so a plugin cannot own a tag, and a
recipe tag is valid in a memo.

**Direction.**

```ts
// src/cards/schema.ts, CardSchemaConfig and the resolved CardSchema
/** Markdoc tags valid in this type's body in addition to the core table. Keys are authored tag names. */
readonly markdocTags?: Readonly<Record<string, Schema>>;
```

`cardSchema()` throws `RedeclaredTagError` when a key is in
`markdocConfig.tags`. `extendSchema` merges `delta.markdocTags` with the
same duplicate rule as fields (`extend-schema.ts`, `SchemaDelta`).

```ts
// src/core/body-markdoc-lint.ts
export function lintBodyMarkdoc(bodyText: string, scopedTags?: Readonly<Record<string, Schema>>): LintIssue[]
// builds { ...markdocConfig, tags: { ...markdocConfig.tags, ...scopedTags } }
```

`lint-cards.ts:276` passes `parsed.schema.markdocTags`. The commentary
schema's own validate (`commentary.tsx:59`) stays as is; commentary declares
no scoped tags.

```ts
// src/frontend/src/components/Markdown/body.tsx, MarkdownProps
/** A type's scoped tags (`CardSchemaConfig.markdocTags`), merged over the core table for this render. */
tags?: Readonly<Record<string, Schema>>;
```

`buildRenderConfig` takes `tags` and spreads them after the core table.

**Undefined tags render their authored form.** Before `transform`, the widget
walks the AST (`ast.walk()`, as `body-refs.ts:320` does) and replaces every
`tag` node whose name is not in the merged table with a core `unknown-tag`
node carrying `name` and the authored attributes; its component renders the
opening tag as muted code, `{% ingredient amount="2" unit="cups" %}`,
followed by the children. Nothing authored disappears from a render, and a
type's scoped tags on a surface that lacks them read as what the author wrote.
The rewrite lives in `src/shared/markdoc-config/scoped.ts` beside
`withScopedTags` so the server-side emitter can share it later. Validation
is unchanged: the authored tag is still `Undefined tag` where it does not
belong. This is the rendering contract: **scoped tags render as components
only through a view that passes the type's `tags`; everywhere else they
render as authored text.** `docs/box/schemas.md` says so beside
`markdocTags`.
`ViewMarkdown` passes `tags` and `components` through; both
`view-widgets.d.ts` files add
`tags?: Readonly<Record<string, Schema>>; components?: Partial<Record<string, ComponentType<Record<string, unknown>>>>`.
`Schema` is imported as a type from `@markdoc/markdoc`, which a box's
`tsc` resolves through beebox's dependency the same way `react` types do.

**Vocabulary lock-ins.** `markdocTags` (schema field), `tags` and
`components` (widget props), `RedeclaredTagError`.

**First chunk.** Schema field + resolve + error + `extendSchema` merge, with
`test/cards/extend-schema.doctest.md` and `test/cards/schema.doctest.md`
cases; `lintBodyMarkdoc` second parameter and the lint-cards call, with a
`test/core/card-lint.doctest.md` case: a box-local type declaring
`{% ingredient %}` validates it; the same tag in a memo warns
`Undefined tag: 'ingredient'`. No open question inside.

### Track 2: recipes as a plugin

**What.** `src/plugins/recipe/` with `plugin.ts`, `recipe.ts` (base with
`markdocTags: recipeTags` and the instructions), `tags.ts` (the six Markdoc
schemas, moved from `tags/core.ts:237-297`), `template.ts`
(`createRecipeTemplate` and the template object from `templates.ts:78-95`),
`view.tsx` (RecipeView over `ViewProps`), `view/tags.tsx`
(`makeRecipeComponents`, `RecipeScaleContext`), `view/recipe.css`
(`bbx-recipe-body`, `bbx-recipe-step` counters), `README.md`. Core deletes
`src/schemas/recipe.tsx`, the `RecipeSchema` registration, the renderer
registration, `RecipeTags.tsx`, `RecipeView.tsx`, the `index.css` rules, the
body.tsx entries, the six tag schemas and table rows, `emitRecipeTag`, the
built-in template, and `registerFileType({ type: "recipe" })`.

**Why.** Recipes are the consumer the slice 1 plan named for scoped tags
(`plugins.md:687`). Without a consumer Track 1 is a field nothing reads.

**Direction.**

- `recipe.ts` imports `LabeledSourcesEntrySchema` today from
  `src/cards/sources-entry.ts` (`recipe.tsx:19`), which the import boundary
  forbids (`plugin-imports.ts:26`). `beebox/cards` exports it; the base
  imports it through `../../exports/cards.js` as the courseware bases do.
- Stubs the README names:
  - `_config/box.json`: `"plugins": ["recipe"]`.
  - `src/schemas/recipe.ts`:
    ```ts
    import { cardSchema } from "beebox/cards";
    import recipe from "beebox/plugins/recipe";
    export { template } from "beebox/plugins/recipe";
    export default cardSchema("recipe", recipe.schemas["recipe"]);
    ```
    A box extends with `extendSchema(recipe.schemas["recipe"], { fields: { rating: ... } })`.
  - `src/views/recipe.tsx`:
    ```tsx
    export { default } from "beebox/plugins/recipe/view";
    export const rendersCardTypes = ["recipe"];
    export const dependencies = ["**/*.recipe.card"];
    ```
- `PluginDefinition` gains `template?: TemplateDefinition`? **No.**
  `plugin.ts` exports `template` by name beside its default
  (`definePlugin` returns `PluginDefinition<S>`, which has no such field);
  the stub re-exports it, and the loader reads it as it reads any box schema
  module's `template` (`schemas.ts:356-358`). `beebox/cards` exports
  `type TemplateDefinition` (today only `TemplateMergePolicy` is public,
  `exports/cards.ts:25`) so the plugin can type it.
- The view finds its card by `params["path"]` as courseware does
  (`courseware/view.tsx:20`), reads `frontmatter` and `body` from `ViewCard`
  (`src/core/views/types.ts:91-103`), keeps `SCALE_OPTIONS` and the scale
  control, and renders
  `<Markdown card={card} tags={recipeTags} components={components}>{body}</Markdown>`
  inside `RecipeScaleContext.Provider`. `Subrecipe` renders a `CardLink`
  (`beebox/view-widgets`) instead of `onNavigate`. `fraction.js` is bundled
  into `dist/plugins/recipe/view.js`; it is declared only in
  `src/frontend/package.json:27` today, and the plugin build resolves from
  the package root, so it moves to `package.json` `dependencies` beside
  `@xyflow/react` (courseware's precedent).
- `view.tsx` and `tags.ts` both import `@markdoc/markdoc` (`Tag` for the
  transforms); the view bundle carries its own copy. `recipe.ts` imports
  `./tags.js`; `plugin.ts` stays Node-safe.
- `emit-tags.ts`: move the `task` case out of `emitRecipeTag`
  (`emit-tags.ts:176-183`, the GFM checkbox the `item` node injects, not a
  recipe tag) into `emitMarkupTag`, then delete `emitRecipeTag` and its
  dispatch line. A recipe tag in a briefing body falls to the unknown-tag
  path (inner content plus a stderr warning), which is correct: it is
  undefined there. The emit doctest keeps a `- [x] done` checklist case.
- `src/frontend/src/file-types/builtins.tsx:35`: delete the recipe row; the
  list icon falls back to the default for stubbed types, as concept-map's
  does.
- Migration (README): list the plugin, write the two stubs, run
  `bbx validate`. No card content changes: the body vocabulary and the
  frontmatter are unchanged. Boxes with recipe cards today: test1 (2),
  one production box (2). `plugin-type-unprovided` is the prompt until done.

**Vocabulary lock-ins.** Plugin name `recipe`; type name `recipe`; view name
`recipe`; CSS prefix `bbx-recipe-`; the six tag names and seven render names
unchanged.

**First chunk.** The plugin directory with base (no `markdocTags` yet),
template, README, registry member and
`test/plugins/recipe/plugin.setup.doctest.md` (stubs written into a temp
box; a recipe card with every tag validates clean; `bbx create` finds the
template). Core deletions of `RecipeSchema`, its registration and the
built-in template in the same commit so the type never exists twice. The
six tags stay in the core table through this checkpoint, so the still-core
`RecipeView` renders them. The second chunk moves the tags and the view
together: `tags.ts`, `markdocTags` on the base, the plugin view, and the
deletions of the core rows, `RecipeView`, `RecipeTags`, renderer
registration, body.tsx entries, CSS and file-type row. Neither checkpoint
renders a recipe without its tags.

### Track 3: conventions guide and its doctest

**What.** Rewrite the Conventions section of `docs/plugins.md` as rules with
a name each, and extend `test/plugins.doctest.md` to check every registered
plugin against the mechanical ones.

**Why.** The section today is six bullets, two of them promises ("slice 2",
"each plugin has a doctest"). `docs/plugins.md` Layout says `SKILL.md` while
courseware ships `skill.ts`, and `package.json:46` globs a `SKILL.md` that
does not exist. Nothing checks that `docs` points at a file or that `name`
equals the directory.

**Direction.** Rules, each one line in the guide:

- `name` equals the directory under `src/plugins/`, kebab-case.
- `docs` names an existing README with the sections What it is, Setup,
  Conventions, Migration, Uninstall.
- Every key of `schemas` appears as a stub path `src/schemas/<key>.ts` in a
  README code block; every `views[].name` as `src/views/<name>.tsx` and has a
  `view.tsx` entry.
- Scoped tag keys are kebab-case and not in the core table (also enforced at
  load by `RedeclaredTagError`).
- Render names of a plugin's tags are unique against the widget's component
  map (`body.tsx:254`); the guide lists the core names. Convention only: a
  synthetic-node check would miss `ingredient`'s inline form
  (`core.ts:242`), and the view doctest renders both forms through the real
  widget, where a shadowed core name would show as the wrong element.
- CSS classes are prefixed `bbx-<plugin>-`.
- A trick a plugin's README asks the agent to write is named `<plugin>-<verb>`.
- Skill body lives in `skill.ts`; the Layout table and `package.json` `files`
  are corrected.

The doctest loops `pluginNames()`, reads each plugin's README through the
shared `readmeStubs()` helper (moved from the courseware doctest to
`test/helpers/plugin-readme.ts`), and asserts the rules above.

**Vocabulary lock-ins.** None new.

**First chunk.** The helper move, the enumerating doctest, the guide rewrite,
the `package.json` glob fix. One commit.

## Could this be simpler?

- **Leave tags global, move only the recipe code.** Fails the boxholder's
  decision and principle 3 (validate at boundaries): a tag that is valid
  everywhere validates nothing about where it belongs.
- **Give the widget the type and let it look tags up.** Needs a client-side
  type → tags table populated from loaded schemas: a registry, two ways of
  reaching a tag (schema field and lookup), and a mechanism the generic card
  page would use only for built-in types. The caller already knows its tags;
  a prop is the caller arg. Memory "minimal concepts, prefer primitives".
- **Share the host's Markdoc with the plugin view through a `window.__bbxMarkdoc`
  shim** (as React is shared). Saves ~100 KB minified in a lazily loaded
  bundle and one `Tag` class copy. The copy is harmless (`$$mdtype` string
  check) and the shim adds a compile-plugin case, a renderer global and a
  Node-target external. Not now; *NOT in scope* records when.
- **Skip the enumerating doctest; keep per-plugin doctests.** Fails
  principle 11: the second plugin is where a per-plugin promise is first
  forgotten.
- **A `template` hook on `PluginDefinition`.** One consumer; the stub's
  `template` export is the existing path (`docs/box/schemas.md:236`).

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A plugin declares a scoped tag with a core name (`quote`) | new: schema doctest | new: `RedeclaredTagError` at `cardSchema()` | clear: load error names the tag |
| A scoped tag is used in another type's body | new: card-lint doctest | existing: Markdoc `tag-undefined`, kept by `lintBodyMarkdoc` | clear: warning with line and tag |
| A scoped tag renders on a generic surface (generic card page, chat excerpt, inactive plugin) | new: frontend doctest renders `{% ingredient amount="2" unit="cups" %}flour{% /ingredient %}` and a `subrecipe` without the recipe tags and asserts the amount, unit and ref are in the output | new: `unknown-tag` rewrite renders the authored opening tag plus children | clear: the authored tag is visible |
| A plugin tag's render name shadows a core component (`Link`) | new: the recipe view doctest renders every form through the real widget | convention in the guide; the merge is per render, so the damage is one card's render | clear in the doctest for the shipped plugin; convention for the next |
| Recipe cards in a box that has not activated the plugin | existing: coverage doctest | existing: `plugin-type-unprovided` error; unknown-type validation | clear: health and validate name the type |
| Box with an old `recipe` stub shape after a base change | existing: `plugin-stub-missing`, typecheck in `bbx upgrade` | existing | clear |
| A briefing body contains a recipe tag after the emitter case is removed | new: emit doctest case | existing: unknown-tag fallback | clear: stderr warning, content kept |
| The plugin view bundle's Markdoc copy builds a `Tag` the host does not recognize | new: view doctest renders every tag through the host `Markdown` | existing: `$$mdtype` string check | would be clear: tag content missing from render in the doctest |
| `template` re-exported from the stub is not picked up | new: setup doctest runs `bbx create X.recipe.card` | existing: box schema loader reads `template` | clear: `bbx create` reports no template |
| README stub paths drift from `schemas` keys | new: conventions doctest | new | clear |

No critical gap: every row has a test and a handler.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field.** ADDRESSED: a recipe tag outside a recipe body
  warns with the tag name (Track 1 chunk 1 test). A recipe-ish tag the agent
  invents (`{% ing %}`) warns the same way, as today.
- **Stale ref.** Unchanged: `subrecipe.ref` keeps its `required` attribute;
  body refs are collected from the raw AST by attribute name
  (`src/core/body-refs.ts:320-326`, `if (attrName !== "ref") continue;`)
  and checked at `lint-cards.ts:190`, independent of the tag table.
- **Two agents touching the same card.** Not affected: no new writes.
- **Hand-edit drift.** ADDRESSED: a stub with the wrong type name is
  `plugin-declared-missing` with reason `defines no recipe schema`
  (slice 1); the view stub without `dependencies` fails to find its card and
  shows the slice 1 "card not among dependencies" message.
- **Fabricated free-form value.** Unchanged: `amount`/`unit` stay strings;
  the instructions' Fidelity section moves verbatim.
- **Validation error UX.** ADDRESSED: `Markdoc body issue at line N
  (ingredient): Undefined tag: 'ingredient'` is the existing format
  (`body-markdoc-lint.ts`); the README's Conventions says what it means.
- **Partial migration.** ADDRESSED: after the engine upgrade and before
  activation, recipe cards are an unknown type: validate reports it,
  `plugin-type-unprovided` names the plugin, the generic view shows the body
  with tag text intact. `bbx upgrade` reports and finishes (slice 1).

## NOT in scope

- Scoping briefing's `purpose`/`correction` and capture-session's
  `image`/`silence`: their cards render on the generic card page, which has
  no type-specific view to pass `tags`; needs the type → tags lookup rejected
  above. Revisit when a built-in type moves to a plugin.
- A host-module shim for `@markdoc/markdoc`: when a second plugin bundles
  Markdoc, or when a plugin tag needs `Tag` identity beyond `$$mdtype`.
- A recipe skill: the base's `instructions` are the vocabulary and the agent
  reads `card-recipe.md` on demand (audit comment,
  `knowledge-audits.yaml:5229-5232`); the courseware skill exists because
  building a course is a procedure, cooking a recipe card is not.
- A recipe index or collection view
  (`issues/features/2026-08-19-collection-views-are-badly-defined.md`).
- Moving figures and judgment: later plans, as `plugins.md:701` says.
- Lints on a plugin's CSS prefix or trick names: convention in the guide;
  the doctest checks what a definition and a README expose.
- Changing `bbx create` for stubbed templates: the loader already reads a
  stub's `template` export.
- The publish lowering for recipe tags: it fails today and stays failing.

## Open design questions

- **Scope briefing's `purpose`/`correction` and capture-session's
  `image`/`silence` in this slice?** The decision says the global table
  shrinks to the core vocabulary. With the `unknown-tag` fallback the move
  is safe, but a briefing on the generic card page would then show
  `{% purpose %}` as authored text instead of the styled block, unless the
  generic page passes built-in types' tags from a frontend map keyed by card
  type (about 60 lines; the same shared tag objects the schemas declare).
  Lean: defer to a follow-up with that map, and keep this slice to the
  plugin consumer. Boxholder's call; *NOT in scope* records the deferral.
- Whether `RecipeScaleContext` should become a widget the host provides so a
  box's own recipe view could reuse scaling. Lean: no; it is the plugin
  view's internal state and a box that wants its own view imports the
  plugin's components.

## Knowledge audits

- Existing `recipe-tag-vocabulary`, `recipe-ingredient-attrs`,
  `recipe-prose-vs-tag` (`knowledge-audits.yaml:5225-5301`) keep their
  `should_read` (`card-recipe.md` exists through the stub in test1). Rerun
  after test1 activates the plugin; record the status comment.
- New `plugins-scoped-tags` (`knows_directly`): "You are writing a memo and
  want to mark an ingredient amount with `{% ingredient %}`. Does that
  validate?" Expected: no, the tag belongs to the recipe type; use prose or
  a recipe card. Lives in the plugins section added in slice 1.
- Rerun `plugins-discover`, `plugins-activate`, `plugins-extend`.

## What will hold this after it ships

- Doctest tier: `test/cards/extend-schema.doctest.md` and
  `test/cards/schema.doctest.md` (field, merge, redeclaration);
  `test/core/card-lint.doctest.md` (scoped tag in and out of its type);
  `test/plugins/recipe/plugin.setup.doctest.md` (stubs into a temp box,
  validate, `bbx create`); `test/plugins/recipe/view.doctest.md` (built
  bundle rendered to a string through `NodeViewHostProvider`, every tag's
  text present, scale applied at 2×); `test/core/markdoc/emit/core.doctest.md`
  (recipe tag falls to the fallback); `test/plugins.doctest.md` (every
  plugin against the conventions). Frontend doctest for the `tags` prop:
  `src/frontend/test/components/Markdown/scoped-tags.doctest.md`.
- The decision that is the risky part, "which tags are valid for this body",
  is a pure function of `(coreTable, schema.markdocTags)`; both the lint and
  the widget call the same `withScopedTags(tags)` helper in
  `src/shared/markdoc-config/scoped.ts` so the two cannot disagree.
- No new test tier, no mock.

## Implementation order

1. Track 1 chunk 1: schema field, `RedeclaredTagError`, `extendSchema`
   merge, `withScopedTags`, `lintBodyMarkdoc` parameter, lint-cards call,
   doctests. Commit.
2. Track 1 chunk 2: widget `tags` prop, `ViewMarkdown` pass-through, both
   `view-widgets.d.ts`, frontend doctest. Commit.
3. Track 2 chunk 1: plugin directory (base without tags, template, README,
   registry member), `beebox/cards` exports (`LabeledSourcesEntrySchema`,
   `type TemplateDefinition`), `fraction.js` at the package root; core
   deletions of `RecipeSchema`, its registration and the built-in template;
   setup doctest. Commit. Depends on 1.
4. Track 2 chunk 2: `tags.ts` and `markdocTags` on the base; plugin view,
   components and CSS; core deletions of the six tag rows and schemas,
   `emitRecipeTag` (after moving `task`), `RecipeView`, `RecipeTags`,
   renderer registration, body.tsx entries, `index.css` rules, file-type row;
   view doctest and emit doctest case. Commit. Depends on 2 and 3.
5. Track 3: helper move, enumerating doctest, guide rewrite, `package.json`
   glob. Commit. Depends on 3 (two plugins to enumerate).
6. Activate in test1 and the worktree clone; run the knowledge audits;
   record status. Cross-model diff review; adjudicate. Plan to `implemented`.
7. After landing (boxholder's ask): activate on the one production box with
   recipe cards, as in slice 1.

## Rollout shape

Tests first: each chunk names its doctests above and is done when they pass
along with `pnpm test:changed`, `pnpm typecheck`, `pnpm lint`,
`pnpm layout-check`. The plugin build runs in the view doctest through the
existing `buildPluginBundlesIntoDist()` helper. Knowledge audits: the three
`recipe-*` and the four `plugins-*` run against test1 after activation.
Migration is agent-run from the README, atomic per box (list, two stubs,
validate), with `plugin-type-unprovided` as the prompt until done; no data
changes.
