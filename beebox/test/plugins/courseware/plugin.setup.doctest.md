# Courseware plugin: the README's stubs validate a course

`src/plugins/courseware/README.md` (Setup) lists what a box writes to use the
plugin: `"plugins": ["courseware"]` in `_config/box.json`, one schema stub per
type under `src/schemas/`, and a view stub. This doctest writes those stubs
(each labelled `<box>/<path>` in the README), character for character, into a temp box and runs `bbx validate` over one card
of each type, so the README cannot drift from what loads.

The box resolves `beebox/plugins/courseware` the way an installed box does: its
`node_modules/beebox` points at the engine package (`makeTmpBox({ deps: true })`),
whose `exports` map serves `dist/plugins/courseware/plugin.js`. That file is the
plugin bundle `pnpm build` emits (`src/scripts/build-cli/build/plugins.ts`); the
setup builds it the same way (`test/helpers/plugin-bundles.ts`) so the test does
not depend on a prior build.

```ts setup
import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { makeTmpBox, type TmpBox } from "../../helpers/doctest-helpers.js";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";
import { isRecord } from "../../../src/shared/is-record.js";
import { buildPluginBundlesIntoDist } from "../../helpers/plugin-bundles.js";
import { loadBoxSchemas } from "../../../src/schemas.js";
import { listSchemaLoadFailures } from "../../../src/schema-load-status.js";

const exec = promisify(execFile);
await buildPluginBundlesIntoDist();

/** The README's Setup section, parsed: each fenced block labelled with the path on the line before it. */
async function readmeStubs(): Promise<Map<string, string>> {
  const readme = await readFile(join(PACKAGE_ROOT, "src/plugins/courseware/README.md"), "utf8");
  const stubs = new Map<string, string>();
  const fence = /`<box>\/([^`\n]+)`:\n\n```(?:ts|tsx|json)\n([\s\S]*?)```/g;
  for (const match of readme.matchAll(fence)) stubs.set(match[1]!, match[2]!);
  return stubs;
}

/** A box with the README's stubs written and the plugin active. */
async function stubbedBox(): Promise<TmpBox> {
  const box = await makeTmpBox({ deps: true, git: true });
  for (const [path, content] of await readmeStubs()) await box.write(path, content);
  return box;
}

/** `bbx validate <paths>` in the box: exit code and the report, box-relative, blank lines dropped. */
async function validate(box: TmpBox, paths: string[]): Promise<{ code: number; report: string[] }> {
  const args = ["--import", import.meta.resolve("tsx"), join(PACKAGE_ROOT, "src/cli/entry/run.ts"), "validate", ...paths];
  // The CLI prints real paths; on macOS the temp root is reached through `/private`,
  // and that longer spelling must go first or the shorter one leaves `/private` behind.
  const roots = [await realpath(box.root), box.root].toSorted((a, b) => b.length - a.length);
  const lines = (text: string) =>
    roots.reduce((acc, root) => acc.replaceAll(`${root}/`, ""), text).split("\n").filter((line) => line.trim() !== "");
  try {
    const { stdout } = await exec(process.execPath, args, { cwd: box.root });
    return { code: 0, report: lines(stdout) };
  } catch (e) {
    // execFile rejects with the exit code and both streams on a nonzero exit.
    if (!isRecord(e)) throw e;
    const code = typeof e["code"] === "number" ? e["code"] : 1;
    const out = typeof e["stdout"] === "string" ? e["stdout"] : "";
    const err = typeof e["stderr"] === "string" ? e["stderr"] : "";
    return { code, report: lines(`${out}${err}`) };
  }
}
```

## The README names five schema stubs, one view stub, and the config

```ts
[...(await readmeStubs()).keys()]
=> [
  "_config/box.json",
  "src/schemas/course.ts",
  "src/schemas/concept-map.ts",
  "src/schemas/exposition-plan.ts",
  "src/schemas/lesson-plan.ts",
  "src/schemas/progress.ts",
  "src/views/concept-map.tsx"
]
```

## A course and its components validate through the stubs

One card of each type, laid out as the skill describes: the course at the top,
its components in the attach scope, the learner's progress beside it. Every
`ref` resolves, every segment names a real node, so `bbx validate` reports no
errors and no warnings.

```ts
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
await validate(box, [
  "_content/courses/Acids.course.card",
  "_content/courses/Acids.attach/Acids_Concept_Map.concept-map.card",
  "_content/courses/Acids.attach/Acids_Exposition_Plan.exposition-plan.card",
  "_content/courses/Acids.attach/Acids_Lesson_Plan.lesson-plan.card",
  "_content/courses/Acids.attach/Learner.progress.card",
])
=> { code: 0, report: ["✓ 5 files checked, no issues found"] }
```

## The stubs carry the bases' validation

The base's Zod fields apply through the stub: a progress entry without
`evidence` is the "no anonymous rating" rule, and it fails validation with the
schema error. The plugin's cross-card lint runs too: a segment naming a node the
map lacks is a warning.

```ts
const box = await stubbedBox();
await box.write("_content/courses/Learner.progress.card", "---\nentries:\n  - node: n\n    level: solid\n    basis: observed\n---\nNo evidence.\n");
await box.write("_content/courses/Acids.attach/Acids_Concept_Map.concept-map.card", "---\nconcepts:\n  - id: acids\n    name: Acids\n    kind: concept\n---\nMap.\n");
await box.write("_content/courses/Acids.attach/Acids_Lesson_Plan.lesson-plan.card", "---\nsegments:\n  - do: Name a node the map lacks\n    mode: interactive\n    concepts: [ghost]\n---\nFlow.\n");
await validate(box, ["_content/courses/Learner.progress.card", "_content/courses/Acids.attach/Acids_Lesson_Plan.lesson-plan.card"])
=> {
  code: 1,
  report: [
    "_content/courses/Learner.progress.card",
    "  error: invalid progress frontmatter:",
    "  - entries[0].evidence: required (expected array)",
    "_content/courses/Acids.attach/Acids_Lesson_Plan.lesson-plan.card",
    "  warning: segments[0].concepts[0] references concept-map node \"ghost\", which the course's concept-map does not define",
    "2 files checked, 1 error and 1 warning in 1 file (1 broken ref)",
  ],
}
```

## The schema stubs load as box schemas

`loadBoxSchemas` is what `bbx validate` used above; read directly, it shows the
five types the stubs register, and the load-failure ledger stays empty.

```ts
const box = await stubbedBox();
const loaded = await loadBoxSchemas(box.root);
({ types: loaded.cardSchemas.map((s) => s.type).toSorted(), failures: listSchemaLoadFailures(box.root) })
=> { types: ["concept-map", "course", "exposition-plan", "lesson-plan", "progress"], failures: [] }
```
