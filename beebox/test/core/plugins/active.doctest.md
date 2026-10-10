# Active plugins and the `plugins` config field

`_config/box.json` `plugins` names the installed plugins a box has activated
(`docs/plugins.md`). `activePluginNames` reads it at the hand-edited-JSON
boundary; `listPlugins` adds each active plugin's stub status; and
`describeInvalidPluginEntries` words the problems for `bbx status` and
`bbx plugins list`.

```ts setup
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { activePluginNames } from "../../../src/core/box/config.js";
import { activePlugins, describeInvalidPluginEntries, listPlugins } from "../../../src/core/plugins/active.js";

async function boxWithPlugins(value) {
  const box = await makeTmpBox();
  await box.write("_config/box.json", JSON.stringify({ plugins: value }));
  return box;
}
```

## A missing field activates nothing; a known name activates that plugin once

```ts
const box = await makeTmpBox();
await activePluginNames(box.root)
=> { active: [], invalid: [] }
```

```ts
const box = await boxWithPlugins(["courseware", "courseware"]);
({ names: await activePluginNames(box.root), active: (await activePlugins(box.root)).map((p) => p.name) })
=> { names: { active: ["courseware"], invalid: [] }, active: ["courseware"] }
```

## An unknown name disables only itself; a malformed field disables everything

Each unknown name is one invalid entry beside the names that do resolve. A
field that is not an array of strings is one invalid entry, the raw value, and
nothing is active: the message says what the field must be rather than
listing each wrong element.

```ts
const box = await boxWithPlugins(["coursware", "courseware"]);
const { active, invalid } = await activePluginNames(box.root);
({ active, problems: describeInvalidPluginEntries(invalid) })
=> { active: ["courseware"], problems: ["box.json names an unknown plugin: coursware"] }
```

```ts
const box = await boxWithPlugins(["courseware", 3]);
const { active, invalid } = await activePluginNames(box.root);
({ active, problems: describeInvalidPluginEntries(invalid) })
=> { active: [], problems: ["box.json \"plugins\" must be an array of plugin names; found [\"courseware\",3]"] }
```

```ts
const box = await boxWithPlugins("courseware");
describeInvalidPluginEntries((await activePluginNames(box.root)).invalid)
=> ["box.json \"plugins\" must be an array of plugin names; found \"courseware\""]
```

## The listing covers every installed plugin and the active ones' stubs

An inactive plugin lists with no stubs. An active plugin lists each declared
schema (`src/schemas/<type>.ts`) and view (`src/views/<name>.tsx`) with whether
the box has written it, since activation is the agent writing those files.

```ts
const box = await makeTmpBox();
(await listPlugins(box.root)).plugins.map((p) => `${p.name} ${p.active ? "active" : "inactive"} ${p.description} ${p.docs} stubs=${p.stubs.length}`)
=> ["courseware inactive Courses, lesson plans, learner progress node_modules/beebox/src/plugins/courseware/README.md stubs=0"]
```

```ts
const box = await boxWithPlugins(["courseware", "nope"]);
await box.write("src/schemas/course.ts", "// stub\n");
await box.write("src/views/concept-map.tsx", "// stub\n");
const { plugins, problems } = await listPlugins(box.root);
({ stubs: plugins[0].stubs.map((s) => `${s.kind} ${s.name} ${s.path} ${s.present ? "present" : "missing"}`), problems })
=> {
  stubs: [
    "schema course src/schemas/course.ts present",
    "schema lesson-plan src/schemas/lesson-plan.ts missing",
    "schema exposition-plan src/schemas/exposition-plan.ts missing",
    "schema progress src/schemas/progress.ts missing",
    "schema concept-map src/schemas/concept-map.ts missing",
    "view concept-map src/views/concept-map.tsx present",
  ],
  problems: ["box.json names an unknown plugin: nope"],
}
```
