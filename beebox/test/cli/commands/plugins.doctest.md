# bbx plugins list

`bbx plugins list` is how the box agent learns a plugin exists
(`docs/plugins.md`): every installed plugin, active or not, with its
description and README path, and for an active plugin whether each declared
stub is present and takes effect. Problems in `_config/box.json` `plugins` come
last, one line each; `bbx status` prints the same lines.

```ts setup
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";

const exec = promisify(execFile);

/** `bbx <args>` run in the box through tsx; stdout as lines. */
async function bbx(box, args) {
  const argv = ["--import", import.meta.resolve("tsx"), join(PACKAGE_ROOT, "src/cli/entry/run.ts"), ...args];
  const { stdout } = await exec(process.execPath, argv, { cwd: box.root });
  return stdout.split("\n").filter((line) => line !== "");
}
```

## Every installed plugin lists, inactive ones without stubs

A new box activates nothing, so the one in-repo plugin lists as inactive:

```ts
const box = await makeTmpBox({ git: true });
await bbx(box, ["plugins", "list"])
=> ["courseware  inactive  Courses, lesson plans, learner progress  docs: node_modules/beebox/src/plugins/courseware/README.md"]
```

## An active plugin shows which stubs the box has written

Activation is the agent listing the name and writing the README's stubs. The
listing is the declared-versus-effective view, so a half-done activation shows
exactly which files are still missing, and a placeholder file (here a comment
with no export) is on disk but defines no schema:

```ts
const box = await makeTmpBox({ git: true });
await box.write("_config/box.json", JSON.stringify({ plugins: ["courseware"] }));
await box.write("src/schemas/course.ts", "// stub\n");
await bbx(box, ["plugins", "list"])
=> [
  "courseware  active  Courses, lesson plans, learner progress  docs: node_modules/beebox/src/plugins/courseware/README.md",
  "  schema course: src/schemas/course.ts present, defines no course schema",
  "  schema lesson-plan: src/schemas/lesson-plan.ts missing",
  "  schema exposition-plan: src/schemas/exposition-plan.ts missing",
  "  schema progress: src/schemas/progress.ts missing",
  "  schema concept-map: src/schemas/concept-map.ts missing",
  "  view concept-map: src/views/concept-map.tsx missing",
]
```

## A stub file that defines no schema of its type is not "present"

The listing reads the effective schema map, not the directory: a
`src/schemas/progress.ts` that registers `other` is on disk but provides no
`progress` schema, and the line says so. (`deps: true` gives the box the
`node_modules/beebox` link the stub's `beebox/cards` import resolves through.)

```ts
const box = await makeTmpBox({ git: true, deps: true });
await box.write("_config/box.json", JSON.stringify({ plugins: ["courseware"] }));
await box.write("src/schemas/progress.ts", 'import { cardSchema } from "beebox/cards";\nimport { z } from "beebox/schema";\n\nexport default cardSchema("other", { fields: { size: z.number() } });\n');
(await bbx(box, ["plugins", "list"])).filter((line) => line.startsWith("  schema progress"))
=> ["  schema progress: src/schemas/progress.ts present, defines no progress schema"]
```

```ts continue
const json = JSON.parse((await bbx(box, ["plugins", "list", "--json"])).join("\n"));
json.plugins[0].stubs.filter((s) => s.name === "progress").map((s) => `${s.present}/${s.effective}`)
=> ["true/false"]
```

## Config problems come last, and `--json` carries the same data

An unknown name is reported after the listing. `--json` emits the plugins and
the problems as one object for a script to read:

```ts
const box = await makeTmpBox({ git: true });
await box.write("_config/box.json", JSON.stringify({ plugins: ["coursware"] }));
(await bbx(box, ["plugins", "list"])).at(-1)
=> box.json names an unknown plugin: coursware
```

```ts continue
const json = JSON.parse((await bbx(box, ["plugins", "list", "--json"])).join("\n"));
({ names: json.plugins.map((p) => `${p.name}:${p.active}`), problems: json.problems })
=> { names: ["courseware:false"], problems: ["box.json names an unknown plugin: coursware"] }
```

## `bbx status` shows the same problems

```ts
const box = await makeTmpBox({ git: true });
await box.write("_config/box.json", JSON.stringify({ plugins: "courseware" }));
(await bbx(box, ["status"])).filter((line) => line.startsWith("box.json"))
=> ["box.json \"plugins\" must be an array of plugin names; found \"courseware\""]
```
