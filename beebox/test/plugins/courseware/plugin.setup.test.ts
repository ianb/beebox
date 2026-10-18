// # Courseware plugin: the README's stubs validate a course
//
// `src/plugins/courseware/README.md` (Setup) lists what a box writes to use the
// plugin: `"plugins": ["courseware"]` in `_config/box.json`, one schema stub per
// type under `src/schemas/`, and a view stub. This doctest writes those stubs
// (each labelled `<box>/<path>` in the README), character for character, into a temp box and runs `bbx validate` over one card
// of each type, so the README cannot drift from what loads.
//
// The box resolves `beebox/plugins/courseware` the way an installed box does: its
// `node_modules/beebox` points at the engine package (`makeTmpBox({ deps: true })`),
// whose `exports` map serves `dist/plugins/courseware/plugin.js`. That file is the
// plugin bundle `pnpm build` emits (`src/scripts/build-cli/build/plugins.ts`); the
// setup builds it the same way (`test/helpers/plugin-bundles.ts`) so the test does
// not depend on a prior build.

import { test } from "tap";
import "agent-doctest/tap";
import type { TmpBox } from "../../helpers/doctest-helpers.js";
import { buildPluginBundlesIntoDist } from "../../helpers/plugin-bundles.js";
import { bbx, readmeStubs as readPluginStubs, stubbedBox as stubbedPluginBox } from "../../helpers/plugin-readme.js";
import { loadBoxSchemas } from "../../../src/schemas.js";
import { listSchemaLoadFailures } from "../../../src/schema-load-status.js";

const readmeStubs = () => readPluginStubs("courseware");
await buildPluginBundlesIntoDist();
const stubbedBox = () => stubbedPluginBox("courseware");

/** `bbx validate <paths>` in the box: exit code and the report. */
async function validate(box: TmpBox, paths: string[]): Promise<{ code: number; report: string[] }> {
  const { code, report } = await bbx(box, ["validate", ...paths]);
  return { code, report };
}

// ## The README names five schema stubs, one view stub, and the config
void test("The README names five schema stubs, one view stub, and the config", async (t) => {
  // doctest:L37
  t.check([...(await readmeStubs()).keys()], [
    "_config/box.json",
    "src/schemas/course.ts",
    "src/schemas/concept-map.ts",
    "src/schemas/exposition-plan.ts",
    "src/schemas/lesson-plan.ts",
    "src/schemas/progress.ts",
    "src/views/concept-map.tsx",
  ]);
});

// ## A course and its components validate through the stubs
//
// One card of each type, laid out as the skill describes: the course at the top,
// its components in the attach scope, the learner's progress beside it. Every
// `ref` resolves, every segment names a real node, so `bbx validate` reports no
// errors and no warnings.
void test("One card of each type, laid out as the skill describes:", async (t) => {
  // doctest:L57
  const box = await stubbedBox();
  await box.write("_content/courses/Acids.course.card", [
    "---",
    "goals: [Build a working model of acids and bases]",
    "success-criteria: [Can predict whether a reaction fizzes and explain why]",
    "concept-map: { ref: attach/Acids_Concept_Map.concept-map.card }",
    "exposition-plan: { ref: attach/Acids_Exposition_Plan.exposition-plan.card }",
    "lesson-plan: { ref: attach/Acids_Lesson_Plan.lesson-plan.card }",
    "progress: { ref: attach/Learner.progress.card }",
    "---",
    "The learner wants a mental model, not the nomenclature.",
    "",
  ].join("\n"));
  await box.write("_content/courses/Acids.attach/Acids_Concept_Map.concept-map.card", [
    "---",
    "concepts:",
    "  - id: proton-transfer",
    "    name: Proton Transfer",
    "    kind: principle",
    "    related: [{ to: conjugate-pairs, kind: complements }]",
    "  - id: conjugate-pairs",
    "    name: Conjugate Pairs",
    "    kind: concept",
    "---",
    "What moves when an acid reacts.",
    "",
  ].join("\n"));
  await box.write("_content/courses/Acids.attach/Acids_Exposition_Plan.exposition-plan.card", [
    "---",
    "learner-translation: [Reasons out loud; lead with their phenomena]",
    "approaches:",
    "  - { approach: socratic dialog, rating: primary, why: Surfaces their model }",
    "---",
    "Dialog first; the rules are in this directory's AGENTS.md.",
    "",
  ].join("\n"));
  await box.write("_content/courses/Acids.attach/Acids_Lesson_Plan.lesson-plan.card", [
    "---",
    "segments:",
    "  - do: Elicit their model of what moves in a reaction",
    "    mode: interactive",
    "    concepts: [proton-transfer]",
    "  - do: A figure to step through, not built yet",
    "    mode: material",
    "    planned: true",
    "    concepts: [conjugate-pairs]",
    "---",
    "Live first; one figure later.",
    "",
  ].join("\n"));
  await box.write("_content/courses/Acids.attach/Learner.progress.card", [
    "---",
    "course: { ref: /_content/courses/Acids.course.card }",
    "entries:",
    "  - node: proton-transfer",
    "    level: partial",
    "    basis: observed",
    "    evidence: [Said acids give something away but could not say what]",
    "---",
    "One sitting so far.",
    "",
  ].join("\n"));
  t.check(
    await validate(box, [
      "_content/courses/Acids.course.card",
      "_content/courses/Acids.attach/Acids_Concept_Map.concept-map.card",
      "_content/courses/Acids.attach/Acids_Exposition_Plan.exposition-plan.card",
      "_content/courses/Acids.attach/Acids_Lesson_Plan.lesson-plan.card",
      "_content/courses/Acids.attach/Learner.progress.card",
    ]),
    {
    code: 0,
    report: [
      "✓ 5 files checked, no issues found",
    ],
  },
  );
});

// ## The stubs carry the bases' validation
//
// The base's Zod fields apply through the stub: a progress entry without
// `evidence` is the "no anonymous rating" rule, and it fails validation with the
// schema error. The plugin's cross-card lint runs too: a segment naming a node the
// map lacks is a warning.
void test("The base's Zod fields apply through the stub:", async (t) => {
  // doctest:L137
  const box = await stubbedBox();
  await box.write("_content/courses/Learner.progress.card", "---\nentries:\n  - node: n\n    level: solid\n    basis: observed\n---\nNo evidence.\n");
  await box.write("_content/courses/Acids.attach/Acids_Concept_Map.concept-map.card", "---\nconcepts:\n  - id: acids\n    name: Acids\n    kind: concept\n---\nMap.\n");
  await box.write("_content/courses/Acids.attach/Acids_Lesson_Plan.lesson-plan.card", "---\nsegments:\n  - do: Name a node the map lacks\n    mode: interactive\n    concepts: [ghost]\n---\nFlow.\n");
  t.check(await validate(box, ["_content/courses/Learner.progress.card", "_content/courses/Acids.attach/Acids_Lesson_Plan.lesson-plan.card"]), {
    code: 1,
    report: [
      "_content/courses/Learner.progress.card",
      "  error: invalid progress frontmatter:",
      "  - entries[0].evidence: required (expected array)",
      "_content/courses/Acids.attach/Acids_Lesson_Plan.lesson-plan.card",
      "  warning: segments[0].concepts[0] references concept-map node \"ghost\", which the course's concept-map does not define",
      "2 files checked, 1 error and 1 warning in 1 file (1 broken ref)",
    ],
  });
});

// ## The schema stubs load as box schemas
//
// `loadBoxSchemas` is what `bbx validate` used above; read directly, it shows the
// five types the stubs register, and the load-failure ledger stays empty.
void test("loadBoxSchemas is what bbx validate used above; read directly, it shows the f...", async (t) => {
  // doctest:L161
  const box = await stubbedBox();
  const loaded = await loadBoxSchemas(box.root);
  t.check(({ types: loaded.cardSchemas.map((s) => s.type).toSorted(), failures: listSchemaLoadFailures(box.root) }), {
    types: [
      "concept-map",
      "course",
      "exposition-plan",
      "lesson-plan",
      "progress",
    ],
    failures: [],
  });
});
