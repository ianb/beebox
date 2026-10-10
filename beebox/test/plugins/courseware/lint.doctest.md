# Courseware plugin: the `lintCards` hook

The courseware plugin's `lintCards` (`src/plugins/courseware/lint.ts`) is the
box-aware check the engine runs over every card while the plugin is active:
progress entries and lesson-plan segments name concept-map nodes by `id`, and
those ids must exist in the course's concept-map; a concept-map's orphan nodes
warn. The engine dispatches it from `lintCardsDispatch` through
`pluginLintIssues` (`src/core/card-lint/core/plugin-lint.ts`), which reads the
active plugins from `_config/box.json` and hands the hook a `LintContext`, so
the plugin resolves refs and lists siblings without importing engine internals.

The temp box here activates the plugin and registers the five types as a box
would through its stubs: `cardSchema(type, base)` over each exported base.

```ts setup
import { cardSchema, type CardSchema } from "../../../src/exports/cards.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { lintCardsDispatch } from "../../../src/core/card-lint/core/lint-cards.js";
import type { LoadCardContext } from "../../../src/core/card-io.js";
import courseware from "../../../src/plugins/courseware/plugin.js";

const ctx: LoadCardContext = {
  cardSchemas: new Map<string, CardSchema>(
    Object.entries(courseware.schemas ?? {}).map(([type, base]) => [type, cardSchema(type, base)]),
  ),
};

/** A box with the plugin active, as `_config/box.json` records it. */
async function coursewareBox(plugins: unknown = ["courseware"]) {
  const box = await makeTmpBox();
  await box.write("_config/box.json", JSON.stringify({ plugins }));
  return box;
}

const MAP = "---\nconcepts:\n  - id: acids\n    name: Acids\n    kind: concept\n  - id: bases\n    name: Bases\n    kind: concept\n---\nMap.\n";
```

## Progress cards: entries must name real concept-map nodes

A progress card's `entries` reference concept-map nodes by `id`. This is checked
box-aware (progress → its `course` → the course's embedded `concept-map`): a
`node` that the map doesn't define is a **warning** (a stale node id, not a hard
error). A valid node id is silent.

```ts
const box = await coursewareBox();
await box.write("_content/store/Acids.course.card", "---\nconcept-map: { ref: attach/Map.concept-map.card }\n---\nCourse.\n");
await box.write("_content/store/Acids.attach/Map.concept-map.card", MAP);
await box.write(
  "_content/store/Learner.progress.card",
  "---\ncourse: { ref: Acids.course.card }\nentries:\n  - node: acids\n    level: partial\n    basis: observed\n    evidence: [heard them explain it]\n  - node: ghost\n    level: solid\n    basis: observed\n    evidence: [refers to a node the map lacks]\n---\nProgress.\n",
);
const result = await lintCardsDispatch([box.path("_content/store/Learner.progress.card")], { boxRoot: box.root, ctx });
({ errors: result.totalErrors, warnings: result.results[0]!.warnings.map((w) => w.message) })
=> {
  errors: 0,
  warnings: ["entries[1].node references concept-map node \"ghost\", which the course's concept-map does not define"],
}
```

## Lesson-plans: segments must name real concept-map nodes, and defer visibly

A lesson-plan's `segments[].concepts[]` reference concept-map nodes by `id`. The
lesson-plan is co-located with the map in the course attach scope, so the check
resolves the **sibling `*.concept-map.card`** (no course back-ref). A `concepts`
id the map doesn't define is a **warning** naming the segment that holds it:

```ts
const box = await coursewareBox();
await box.write("_content/store/Acids.attach/Acids_Concept_Map.concept-map.card", MAP);
await box.write(
  "_content/store/Acids.attach/Acids_Lesson_Plan.lesson-plan.card",
  "---\nsegments:\n  - do: Elicit their model\n    mode: interactive\n    concepts: [acids]\n  - do: Name a node the map lacks\n    mode: interactive\n    concepts: [ghost]\n---\nFlow.\n",
);
const result = await lintCardsDispatch([box.path("_content/store/Acids.attach/Acids_Lesson_Plan.lesson-plan.card")], { boxRoot: box.root, ctx });
result.results[0]!.warnings.map((w) => w.message)
=> ["segments[1].concepts[0] references concept-map node \"ghost\", which the course's concept-map does not define"]
```

A `material` segment that has neither a `material` ref nor `planned: true` is a
**deferral warning** — "incomplete material" is stated, never silent:

```ts
const box = await coursewareBox();
await box.write("_content/store/Acids.attach/Acids_Concept_Map.concept-map.card", MAP);
await box.write(
  "_content/store/Acids.attach/Acids_Lesson_Plan.lesson-plan.card",
  "---\nsegments:\n  - do: Hand them a doc\n    mode: material\n---\nFlow.\n",
);
const result = await lintCardsDispatch([box.path("_content/store/Acids.attach/Acids_Lesson_Plan.lesson-plan.card")], { boxRoot: box.root, ctx });
result.results[0]!.warnings.map((w) => w.message)
=> ["segments[0]: material segment with no material card — ref a card or mark it 'planned: true'"]
```

A valid plan — every `concepts` id real, every material segment either with a
resolvable ref or explicitly `planned: true` — is silent:

```ts
const box = await coursewareBox();
await box.write("_content/store/Acids.attach/Acids_Concept_Map.concept-map.card", MAP);
await box.write("_content/store/Acids.attach/Recap.doc.card", "---\ntitle: Recap\n---\nRecap.\n");
await box.write(
  "_content/store/Acids.attach/Acids_Lesson_Plan.lesson-plan.card",
  "---\nsegments:\n  - do: Elicit their model\n    mode: interactive\n    concepts: [acids]\n  - do: Read the recap\n    mode: material\n    concepts: [bases]\n    material: { ref: Recap.doc.card }\n  - do: A future figure, not built yet\n    mode: material\n    planned: true\n---\nFlow.\n",
);
const result = await lintCardsDispatch([box.path("_content/store/Acids.attach/Acids_Lesson_Plan.lesson-plan.card")], { boxRoot: box.root, ctx });
result.totalWarnings
=> 0
```

## Concept-maps: an orphan node (no edge in or out) warns

A concept-map node with no edges — nothing it depends on, nothing depending on it
— is a modeling smell, surfaced as a **warning** naming the node. A map where
every node connects is silent; a 0–1 node map is never flagged (edges aren't
possible).

```ts
const box = await coursewareBox();
await box.write(
  "_content/store/Bonds.concept-map.card",
  "---\nconcepts:\n  - id: ionic\n    name: Ionic Bonds\n    kind: concept\n  - id: covalent\n    name: Covalent Bonds\n    kind: concept\n    related:\n      - { to: ionic, kind: contrasts-with }\n  - id: trivia\n    name: A Floating Aside\n    kind: fact\n---\nMap.\n",
);
const result = await lintCardsDispatch([box.path("_content/store/Bonds.concept-map.card")], { boxRoot: box.root, ctx });
({ errors: result.totalErrors, warnings: result.results[0]!.warnings.map((w) => w.message) })
=> { errors: 0, warnings: ["concept \"trivia\" is an orphan — no edge in or out; connect it or remove it"] }
```

A fully connected map warns about nothing:

```ts
const box = await coursewareBox();
await box.write(
  "_content/store/Bonds2.concept-map.card",
  "---\nconcepts:\n  - id: ionic\n    name: Ionic Bonds\n    kind: concept\n  - id: covalent\n    name: Covalent Bonds\n    kind: concept\n    related:\n      - { to: ionic, kind: contrasts-with }\n---\nMap.\n",
);
const result = await lintCardsDispatch([box.path("_content/store/Bonds2.concept-map.card")], { boxRoot: box.root, ctx });
result.totalWarnings
=> 0
```

## The hook runs only while the plugin is active

The same orphan map in a box whose `_config/box.json` names no plugins gets no
plugin warning: the schema still validates it (the box registered the type),
but the cross-card checks are the active plugin's.

```ts
const box = await coursewareBox([]);
await box.write(
  "_content/store/Bonds.concept-map.card",
  "---\nconcepts:\n  - id: ionic\n    name: Ionic Bonds\n    kind: concept\n  - id: trivia\n    name: A Floating Aside\n    kind: fact\n---\nMap.\n",
);
const result = await lintCardsDispatch([box.path("_content/store/Bonds.concept-map.card")], { boxRoot: box.root, ctx });
result.totalWarnings
=> 0
```

A `plugins` entry that names no installed plugin is reported as a warning on
each linted card, so a typo in the config is visible rather than silently
disabling the checks:

```ts
const box = await coursewareBox(["coursware"]);
await box.write("_content/store/Bonds.concept-map.card", MAP);
const result = await lintCardsDispatch([box.path("_content/store/Bonds.concept-map.card")], { boxRoot: box.root, ctx });
result.results[0]!.warnings.map((w) => w.message)
=> ["_config/box.json names an unknown plugin: coursware; the card is not linted by that plugin"]
```
