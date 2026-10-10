# health: plugin coverage, skill conflicts, and plugin-owned checks

`pluginHealthChecks` (`src/webapp/trpc/routers/health/checks/plugins/core.ts`) is
what `runHealthChecks` appends after `template-updates`. Every row derives from
the effective schema map (`createCardSchemaMap`) and the box's active list
together, so an inactive plugin with cards on disk and an active plugin with
no stub are both visible (`docs/plugins.md`, "Health").

```ts setup
import { pluginHealthChecks } from "../../../../../../../src/webapp/trpc/routers/health/checks/plugins/core.js";
import { withDocId } from "../../../../../../../src/core/docs-gen/shared.js";
import { makeTmpBox } from "../../../../../../helpers/doctest-helpers.js";

/** Only the failing rows, as `{ name, severity, message }`. */
function failing(checks) {
  return checks.filter((c) => !c.ok).map(({ name, severity, message }) => ({ name, severity, message }));
}

async function boxWithPlugins(plugins) {
  const box = await makeTmpBox();
  await box.write("_config/box.json", JSON.stringify({ plugins }));
  return box;
}

const fixturePlugin = (healthChecks) => ({
  name: "courseware",
  description: "Fixture standing in for courseware",
  docs: "src/plugins/courseware/README.md",
  healthChecks,
});
```

## A box with no plugin involvement passes every row

The quiet case enumerates each check as ok, so `bbx health`'s pass count is
stable.

```ts
const quiet = await makeTmpBox();
const checks = await pluginHealthChecks(quiet.root);
checks.map((c) => `${c.name}:${c.ok ? "ok" : "FAIL"}`)
=> [
  "plugin-type-unprovided:ok",
  "plugin-declared-missing:ok",
  "plugin-stub-inactive:ok",
  "plugin-stub-missing:ok",
  "skill-name-conflict:ok",
  "legacy-exposition-rules:ok",
]
```

```ts cleanup
await quiet.cleanup();
```

## Cards of a plugin's type with the plugin inactive

Two course cards and no `courseware` in `_config/box.json`: the cards have no
schema, and the message names the plugin that provides one. Nothing is
"declared missing" because the plugin is not active.

```ts
const inactive = await makeTmpBox();
await inactive.write("content/Acids.course.card", "---\n---\nAcids.\n");
await inactive.write("content/Bases.course.card", "---\n---\nBases.\n");
failing(await pluginHealthChecks(inactive.root))
=> [{
  name: "plugin-type-unprovided",
  severity: "error",
  message: "2 cards of type course have no schema. The courseware plugin provides it: `bbx plugins list`, then its README.",
}]
```

```ts cleanup
await inactive.cleanup();
```

## Active plugin with no stubs

The plugin is listed but no stub completes it: one card is unprovided, and
every declared type and view is reported with the stub path to write.

```ts
const bare = await boxWithPlugins(["courseware"]);
await bare.write("content/Acids.course.card", "---\n---\nAcids.\n");
failing(await pluginHealthChecks(bare.root))
=> [
  { name: "plugin-type-unprovided", severity: "error", message: "1 card of type course has no schema. The courseware plugin provides it: `bbx plugins list`, then its README." },
  { name: "plugin-declared-missing", severity: "error", message: "The courseware plugin is active but its schema course has no stub at src/schemas/course.ts. Write it from node_modules/beebox/src/plugins/courseware/README.md, Setup." },
  { name: "plugin-declared-missing", severity: "error", message: "The courseware plugin is active but its schema lesson-plan has no stub at src/schemas/lesson-plan.ts. Write it from node_modules/beebox/src/plugins/courseware/README.md, Setup." },
  { name: "plugin-declared-missing", severity: "error", message: "The courseware plugin is active but its schema exposition-plan has no stub at src/schemas/exposition-plan.ts. Write it from node_modules/beebox/src/plugins/courseware/README.md, Setup." },
  { name: "plugin-declared-missing", severity: "error", message: "The courseware plugin is active but its schema progress has no stub at src/schemas/progress.ts. Write it from node_modules/beebox/src/plugins/courseware/README.md, Setup." },
  { name: "plugin-declared-missing", severity: "error", message: "The courseware plugin is active but its schema concept-map has no stub at src/schemas/concept-map.ts. Write it from node_modules/beebox/src/plugins/courseware/README.md, Setup." },
  { name: "plugin-declared-missing", severity: "error", message: "The courseware plugin is active but its view concept-map has no stub at src/views/concept-map.tsx. Write it from node_modules/beebox/src/plugins/courseware/README.md, Setup." },
]
```

```ts cleanup
await bare.cleanup();
```

## A box skill under the plugin's name

The engine marks every skill file it writes (`guidance-sync/skills.ts`), and a
plugin's skill is managed while the plugin is active. An unmarked
`.claude/skills/courseware/SKILL.md` is the box's own, so the plugin's skill was
not written over it; `skillConflicts` reports it and the check says so.

```ts
const owned = await boxWithPlugins(["courseware"]);
await owned.write(".claude/skills/courseware/SKILL.md", "---\nname: courseware\n---\nMy own notes.\n");
failing(await pluginHealthChecks(owned.root)).filter((c) => c.name === "skill-name-conflict")
=> [{
  name: "skill-name-conflict",
  severity: "warning",
  message: ".claude/skills/courseware/SKILL.md is a box skill the engine did not write, so the managed courseware skill is not installed. Rename or remove the box skill to receive it.",
}]
```

The engine's own marked file is not a conflict:

```ts continue
const relativePath = ".claude/skills/courseware/SKILL.md";
await owned.write(relativePath, withDocId({ relativePath, content: "---\nname: courseware\n---\nMirrored.\n" }));
failing(await pluginHealthChecks(owned.root)).some((c) => c.name === "skill-name-conflict")
=> false
```

```ts cleanup
await owned.cleanup();
```

## A plugin's own checks are prefixed; a throw is one failing row

Each active plugin's `healthChecks(boxRoot)` runs with its rows renamed
`<plugin>/<name>`. The `plugins` option stands in for the registry so a fixture
can misbehave; `runHealthChecks` passes the same option through.

```ts
const hooked = await boxWithPlugins(["courseware"]);
const own = fixturePlugin(async () => [{ name: "maps-current", ok: true, message: "All maps rebuilt", severity: "warning" }]);
(await pluginHealthChecks(hooked.root, { plugins: [own] })).filter((c) => c.name.startsWith("courseware/"))
=> [{ name: "courseware/maps-current", ok: true, message: "All maps rebuilt", severity: "warning" }]
```

A hook that throws does not take the rest of health down with it:

```ts continue
const broken = fixturePlugin(async () => { throw new Error("concept map index unreadable"); });
failing(await pluginHealthChecks(hooked.root, { plugins: [broken] })).filter((c) => c.name.startsWith("courseware/"))
=> [{ name: "courseware/checks", severity: "error", message: "The courseware plugin's health checks threw: concept map index unreadable" }]
```

```ts cleanup
await hooked.cleanup();
```
