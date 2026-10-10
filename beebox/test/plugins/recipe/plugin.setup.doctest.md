# Recipe plugin: the README's stubs validate a recipe

`src/plugins/recipe/README.md` (Setup) lists what a box writes to use the
plugin: `"plugins": ["recipe"]` in `_config/box.json`, a schema stub, and a view
stub. This doctest writes those stubs (each labelled `<box>/<path>` in the
README), character for character, into a temp box and validates a recipe card
that uses every tag, so the README cannot drift from what loads.

The box resolves `beebox/plugins/recipe` through its `node_modules/beebox`
symlink to the engine package; the setup builds the plugin bundles first
(`test/helpers/plugin-bundles.ts`) so the test does not depend on a prior build.

```ts setup
import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { makeTmpBox, type TmpBox } from "../../helpers/doctest-helpers.js";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";
import { isRecord } from "../../../src/shared/is-record.js";
import { buildPluginBundlesIntoDist } from "../../helpers/plugin-bundles.js";
import { readmeStubs as readPluginStubs } from "../../helpers/plugin-readme.js";

const exec = promisify(execFile);
const readmeStubs = () => readPluginStubs("recipe");
await buildPluginBundlesIntoDist();
const CLI = join(PACKAGE_ROOT, "src/cli/entry/run.ts");

/** A box with the README's stubs written and the plugin active. */
async function stubbedBox(): Promise<TmpBox> {
  const box = await makeTmpBox({ deps: true, git: true });
  for (const [path, content] of await readmeStubs()) await box.write(path, content);
  return box;
}

/** `bbx <args>` in the box: exit code and the report, box-relative, blank lines dropped. */
async function bbx(box: TmpBox, args: string[]): Promise<{ code: number; stdout: string; report: string[] }> {
  const roots = [await realpath(box.root), box.root].toSorted((a, b) => b.length - a.length);
  const lines = (text: string) =>
    roots.reduce((acc, root) => acc.replaceAll(`${root}/`, ""), text).split("\n").filter((line) => line.trim() !== "");
  try {
    const { stdout } = await exec(process.execPath, ["--import", import.meta.resolve("tsx"), CLI, ...args], { cwd: box.root });
    return { code: 0, stdout, report: lines(stdout) };
  } catch (e) {
    if (!isRecord(e)) throw e;
    const code = typeof e["code"] === "number" ? e["code"] : 1;
    const out = typeof e["stdout"] === "string" ? e["stdout"] : "";
    const err = typeof e["stderr"] === "string" ? e["stderr"] : "";
    return { code, stdout: out, report: lines(`${out}${err}`) };
  }
}
```

## The README names the config, one schema stub and one view stub

```ts
[...(await readmeStubs()).keys()]
=> ["_config/box.json", "src/schemas/recipe.ts", "src/views/recipe.tsx"]
```

## A recipe using every tag validates through the stubs

Inline and block `ingredient`, `yield`, `step`, `substitution`, `recipe-section`,
and a `subrecipe` whose `ref` names a second recipe card.

```ts
const box = await stubbedBox();
await box.write("_content/recipes/Marinara.recipe.card", [
  "---",
  "title: Marinara",
  "---",
  "{% yield amount=\"2\" %}2 cups{% /yield %}",
  "",
  "{% step %}Simmer {% ingredient amount=\"1\" unit=\"can\" %}tomatoes{% /ingredient %}.{% /step %}",
  "",
].join("\n"));
await box.write("_content/recipes/Dinner.recipe.card", [
  "---",
  "title: Dinner",
  "tags: [pasta]",
  "---",
  "{% yield amount=\"4\" %}4 servings{% /yield %}",
  "",
  "## Ingredients",
  "",
  "- {% ingredient amount=\"2\" unit=\"cups\" %}flour{% /ingredient %}",
  "- {% ingredient amount=\"1/2\" unit=\"tsp\" %}salt{% /ingredient %}",
  "",
  "{% recipe-section name=\"Sauce\" %}",
  "{% subrecipe ref=\"/_content/recipes/Marinara.recipe.card\" %}Make a half batch.{% /subrecipe %}",
  "{% /recipe-section %}",
  "",
  "## Steps",
  "",
  "{% step %}Mix the {% ingredient amount=\"2\" unit=\"cups\" %}flour{% /ingredient %} with water.{% /step %}",
  "",
  "{% substitution for=\"flour\" %}Use whole wheat.{% /substitution %}",
  "",
].join("\n"));
const result = await bbx(box, ["validate", "_content/recipes/Dinner.recipe.card", "_content/recipes/Marinara.recipe.card"]);
({ code: result.code, report: result.report })
=> { code: 0, report: ["✓ 2 files checked, no issues found"] }
```

## `bbx create` finds the template the stub re-exports

```ts
const box = await stubbedBox();
const created = await bbx(box, ["create", "_content/recipes/Dinner.recipe.card", "title=Dinner"]);
({ code: created.code, hasYield: (await readFile(join(box.root, "_content/recipes/Dinner.recipe.card"), "utf8")).includes("{% yield") })
=> { code: 0, hasYield: true }
```

## `bbx plugins list` shows the plugin active with both stubs

```ts
const box = await stubbedBox();
const listed = JSON.parse((await bbx(box, ["plugins", "list", "--json"])).stdout);
listed.plugins.filter((p) => p.name === "recipe").map((p) => ({ active: p.active, stubs: p.stubs.map((s) => ({ kind: s.kind, name: s.name, present: s.present, effective: s.effective })) }))
=> [{
  active: true,
  stubs: [
    { kind: "schema", name: "recipe", present: true, effective: true },
    { kind: "view", name: "recipe", present: true, effective: true }
  ]
}]
```
