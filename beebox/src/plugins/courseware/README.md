# Courseware

## What it is

Courseware is the plugin for courses a box builds with a learner. It ships five
card bases, one view, one skill and one lint hook:

- `course`: the manifest for one learning experience. It binds the other
  components by `ref`.
- `concept-map`: the knowledge graph for the topic. Concepts are nodes inside
  the card; edges name other nodes by `id`.
- `exposition-plan`: how to present the material, with the reasoning kept in.
- `lesson-plan`: the ordered delivery flow. Each segment is `interactive` (live
  in chat) or `material` (a pre-made card).
- `progress`: a per-learner, evidence-backed record of understanding against
  the concept-map's nodes.
- The `concept-map` view renders the graph (React Flow and dagre) under the
  card's prose.
- The `courseware` skill is the process: probe, set success criteria, map,
  seed progress, plan the exposition, plan the delivery, make it runnable,
  adapt. It ends with worked `figure` examples.
- The lint hook checks progress entries and lesson-plan segments against the
  course's concept-map, warns on a material segment that is neither built nor
  `planned: true`, and warns on an orphan concept-map node.

Nothing here runs until a box activates the plugin and writes the stubs below.
A box without them has no `course` type; cards of these types in such a box
are reported by the `plugin-type-unprovided` health check.

## Setup

Three steps, all box files. Commit them.

1. Activate the plugin in `_config/box.json`:

`<box>/_config/box.json`:

```json
{
  "plugins": ["courseware"]
}
```

Keep the box's other settings; add the `plugins` key beside them.

2. Write one schema stub per type under `src/schemas/`. Each completes the
plugin's base with the default type name.

`<box>/src/schemas/course.ts`:

```ts
import { cardSchema } from "beebox/cards";
import courseware from "beebox/plugins/courseware";

export default cardSchema("course", courseware.schemas["course"]);
```

`<box>/src/schemas/concept-map.ts`:

```ts
import { cardSchema } from "beebox/cards";
import courseware from "beebox/plugins/courseware";

export default cardSchema("concept-map", courseware.schemas["concept-map"]);
```

`<box>/src/schemas/exposition-plan.ts`:

```ts
import { cardSchema } from "beebox/cards";
import courseware from "beebox/plugins/courseware";

export default cardSchema("exposition-plan", courseware.schemas["exposition-plan"]);
```

`<box>/src/schemas/lesson-plan.ts`:

```ts
import { cardSchema } from "beebox/cards";
import courseware from "beebox/plugins/courseware";

export default cardSchema("lesson-plan", courseware.schemas["lesson-plan"]);
```

`<box>/src/schemas/progress.ts`:

```ts
import { cardSchema } from "beebox/cards";
import courseware from "beebox/plugins/courseware";

export default cardSchema("progress", courseware.schemas["progress"]);
```

To add a field, wrap the base with `extendSchema` from `beebox/cards`:
`cardSchema("progress", extendSchema(courseware.schemas["progress"], { fields: { mood: z.string().optional() } }))`,
with `z` from `beebox/schema`. A field the base already declares is an error.

3. Write the view stub. The view finds the card it renders by `params.path`
among the cards its `dependencies` globs select, so the glob is required.

`<box>/src/views/concept-map.tsx`:

```tsx
export { default } from "beebox/plugins/courseware/view";
export const rendersCardTypes = ["concept-map"];
export const dependencies = ["**/*.concept-map.card"];
```

After the commit, the next `bbx wakeup` or chat start mirrors the skill into
`.claude/skills/courseware/`, and `bbx validate` runs the lint hook. The
doctest `test/plugins/courseware/plugin.setup.doctest.md` writes these exact files
into a temp box and validates one card of each type, so this section is what
loads.

## Conventions

- The type names above are the defaults the plugin assumes. The lint hook
  dispatches on them: `progress`, `lesson-plan` and `concept-map` cards get
  the node-reference, deferral and orphan checks, and a `course` card's
  `concept-map` ref is how a progress card finds its map. A box may register
  a base under another name; cards of that type still validate, but these
  checks do not run for them, and the skill's instructions name the defaults.
- A lesson-plan finds its concept-map as the sibling `*.concept-map.card` in
  its own directory, so the two live together in the course's attach scope.
- A progress card finds its concept-map through its `course` ref, then the
  course's `concept-map` ref. A progress card may live anywhere in the box.
- `exposition-plan` keeps a `rules` field so older cards validate. It is
  legacy: the presentation rules go in the course directory's nested
  `AGENTS.md` (see Migration). Nothing reads the field.
- `dist/plugins/courseware/view.d.ts` carries the view's stylesheet import.
  The typechecker ignores it; the stylesheet is inlined into the bundle as a
  `<style>` element, so the stub needs no CSS step.
- The skill is one file. The engine writes its frontmatter from the plugin's
  name and description.

## Migration

For a box created on an engine where these five types were built in:

1. Activate the plugin and write the stubs (Setup). Existing cards keep their
   type names and validate unchanged.
2. For each exposition-plan card with a nonempty `rules` field, write the
   rules into `AGENTS.md` in the course directory (the attach scope that holds
   the course components) under a `## Presentation rules` heading, then remove
   the `rules` field from the card. The `legacy-exposition-rules` health check
   lists the cards still carrying one; the migration is done when it is quiet.
3. Delete any generated `.claude/rules/exposition-*.md` files. The engine no
   longer writes them and removes the marked ones it finds.
4. The managed `build-course` skill is retired by the engine; the plugin's
   skill is mirrored to `.claude/skills/courseware/` while the plugin is
   active. Update any box instruction that names `build-course`.

Run `bbx validate` after the move. Templates for these types are gone from
`bbx create -t`; copy the frontmatter shapes from the skill and the card docs
instead.

## Uninstall

Remove `courseware` from `plugins` in `_config/box.json` and commit. The
stubs stay as box code and keep compiling, so existing cards still validate;
the lint hook stops running, and the engine retires the mirrored skill. To
remove the types as well, delete the stubs; cards of those types then show as
unknown types in `bbx validate` until they are moved or deleted.

Tell the person what stays: their course cards and material are untouched,
the concept-map view is gone until the stub is restored, and the
`courseware` skill no longer loads.
