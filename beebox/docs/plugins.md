# Plugins

A plugin is a typed library shipped inside the `beebox` package and reached
through the public subpath `beebox/plugins/<name>`. A box uses a plugin by
listing it in `_config/box.json` and writing small stubs that import and
extend it. Nothing new runs at runtime: a stub is an ordinary box schema,
view or trick, loaded by the mechanisms that load every other one. The design
and its decisions: [plugins plan](plans/plugins.md),
[design notes](plans/plugins-design-notes.md). The standing position
("knowledge, not plugins": no registry service, no marketplace, no lifecycle
framework) is in [extensibility](design/extensibility.md) and still holds.

## Three tiers

Before writing a plugin, pick the tier.

| Tier | Use it when | Artifact |
|---|---|---|
| Instruction | The agent can call a service with what it already has (omdb, tmdb) | A documentation entry; the service is consumed, not integrated |
| Trick | A script that integrates with nothing | A well-structured trick the docs point at; the agent copies it into `src/tricks/scripts/` |
| Plugin | The engine must know about it: a card type it validates, a view, a lint over cards, a health check | `src/plugins/<name>/` |

A plugin exists only for the third case.

## Vocabulary

- **Installed**: present in the engine package. Every in-repo plugin, always.
- **Active**: named in `_config/box.json` under `plugins`. The only mechanical
  state. Active means: the plugin's skill is mirrored into
  `.claude/skills/<name>/`, its lint and health hooks run, and
  `bbx plugins list` shows it as active. New boxes activate nothing.
- **Base**: a `CardSchemaConfig` the plugin exports without a type name, keyed
  by its default type name in `schemas`.
- **Stub**: the box file that completes a base, re-exports a view, or calls a
  script. The box owns it; the engine never writes or overwrites it.
- **Effective schemas**: built-in types plus the box's loaded stubs. Health is
  computed from these, never from the active list alone.

## Layout

```
src/plugins/<name>/
  plugin.ts     default-exports definePlugin({...}); Node-safe
  view.tsx      optional; browser-safe; the stub re-exports it
  README.md     What it is · Setup · Conventions · Migration · Uninstall
  SKILL.md      body only; the engine writes the frontmatter
  <own files>
src/plugins.ts  the registry; add the member here
```

`plugin.ts` and `view.tsx` are separate entries because `plugin.ts` may import
`node:fs` for a health check while `view.tsx` must bundle for the browser.
The build emits `dist/plugins/<name>/plugin.js` and `view.js`; the export map
names both.

## The contract

```ts
import { definePlugin } from "../../cards/plugin-definition.js";
export default definePlugin({
  name: "courseware",                       // equals the directory name
  description: "Courses, lesson plans, learner progress",   // passes the brief lint
  docs: "src/plugins/courseware/README.md",
  skill: SKILL_BODY,
  schemas: { course: courseBase, "lesson-plan": lessonPlanBase },  // key = default type name
  views: [{ name: "concept-map", rendersCardTypes: ["concept-map"] }],
  healthChecks: async (boxRoot) => [...],   // read-only
  lintCards: async (input, ctx) => [...],   // box-aware; uses ctx, never engine imports
});
```

The declarative fields are read without running anything. The two hooks are
the whole hook surface; add a new hook kind only with a real consumer and a
plan.

## The import boundary

A file under `src/plugins/<name>/` may import only `beebox/{cards,schema,view-widgets}`
through `src/exports/*`, `src/cards/plugin-definition.ts`, its own
directory, and external packages. `view.tsx` may not import `node:*`. The
`plugin-imports` layout rule and an ESLint block enforce this. The rule is
what keeps an in-repo plugin from being core by another name: if a plugin
needs an engine internal, the engine is missing a public piece, and that is
a separate change.

## Stubs

Schema stub, `<box>/src/schemas/progress.ts`:

```ts
import { cardSchema, extendSchema } from "beebox/cards";
import { z } from "beebox/schema";
import courseware from "beebox/plugins/courseware";
export default cardSchema("progress", extendSchema(courseware.schemas.progress, {
  fields: { mood: z.string().optional() },
}));
```

`extendSchema` merges fields (a key present in both is a type error), runs
both `validate` and both `superRefine` hooks, chains `summarize`, and
concatenates `instructions`. Scalar options are delta-wins.

View stub, `<box>/src/views/concept-map.tsx`:

```ts
export { default } from "beebox/plugins/courseware/view";
export const rendersCardTypes = ["concept-map"];
```

Stubs use static imports; the health checks find plugin references by
scanning import specifiers.

## Activation is agent-run

The README's Setup section lists the exact stubs. The agent adds the name to
`plugins` in `_config/box.json`, writes the stubs, and commits. No plugin code
runs at activation. `bbx plugins list` shows every installed plugin, active or
not, with its description and README path; the agent guide carries one
standing line pointing at it.

## Health

Core owns these checks; they derive from effective schemas and the active
list together:

- `plugin-type-unprovided`: cards of a type with no effective schema that
  some plugin declares. Error. Covers both "inactive" and "active but no
  stub".
- `plugin-declared-missing`: an active plugin declares a type or view with no
  stub. Error.
- `plugin-stub-inactive`: a stub imports a plugin that is not active. Warning.
- `plugin-stub-missing`: a stub imports a plugin that does not exist, or the
  stub failed to load. Error.
- `skill-name-conflict`: a managed skill's name (a plugin's or a static one) collides with an unmarked box
  skill; the engine did not overwrite it. Warning.
- `legacy-exposition-rules`: an exposition-plan card still carries a non-empty
  `rules` field (courseware README, Migration). Warning. Core owns it so it
  fires while the plugin is inactive.
- `<plugin>/...`: the plugin's own `healthChecks`, prefixed.

`bbx upgrade` validates the whole box under the new engine after migrations.
Failures are reported and the upgrade finishes; they never block it.

## Deactivation, removal, rot

Remove the name from `box.json`. The stubs stay as box code and keep
compiling; the skill the engine wrote is retired (marked files only). A
plugin removed from the engine breaks its stubs' imports: the loader reports
it, `plugin-stub-missing` names it, and `bbx upgrade` fails typecheck before
committing. The project never removes a plugin in the release that adds its
replacement, and the README's Migration section names the script to run.

## Conventions

- Default type names are the convention cross-card checks rely on. A box may
  rename a type; the README says which checks that disables.
- Markdoc tags are declared on the schema and valid only in that type's body
  (slice 2 of the plan; until then, tags stay in the core table).
- A plugin ships no secrets; a script's `secrets.json` is the box's.
- Health checks are read-only. Lint hooks receive a `LintContext` and import
  nothing from the engine.
- Each plugin has a doctest that writes its README's stubs into a temp box
  and runs `bbx validate`, so the docs cannot drift from what compiles.
- Migration is manual and agent-run. A plugin may ship a mechanical update
  script; the README tells the agent to run it.
