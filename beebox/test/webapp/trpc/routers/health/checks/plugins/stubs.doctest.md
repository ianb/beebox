# health: plugin stub imports

A stub is a box file that imports `beebox/plugins/<name>` (`docs/plugins.md`).
`scanStubImports` reads the import specifiers of `src/schemas/*.ts`,
`src/views/*.tsx`, and `src/tricks/scripts/<trick>/index.ts` without executing
them, and `stubImportChecks` turns them into `plugin-stub-inactive` (the plugin
is installed, not active) and `plugin-stub-missing` (no such plugin, or the
stub failed to load).

```ts setup
import { scanStubImports, stubImportChecks } from "../../../../../../../src/webapp/trpc/routers/health/checks/plugins/stubs.js";
import { makeTmpBox } from "../../../../../../helpers/doctest-helpers.js";

function failing(checks) {
  return checks.filter((c) => !c.ok).map(({ name, severity, message }) => ({ name, severity, message }));
}
```

## Scanning: default, side-effect, re-export and multi-line imports

The regex sees static `import`/`export ... from` forms, including a view
re-export of `beebox/plugins/<name>/view` and an import split across lines. A
dynamic `import()` is not a stub by the README's convention and is not seen.

```ts
const box = await makeTmpBox();
await box.write("src/schemas/course.ts", 'import { cardSchema } from "beebox/cards";\nimport courseware from "beebox/plugins/courseware";\n\nexport default cardSchema("course", courseware.schemas["course"]);\n');
await box.write("src/views/concept-map.tsx", 'export { default } from "beebox/plugins/courseware/view";\n');
await box.write("src/tricks/scripts/syllabus/index.ts", 'import {\n  build,\n} from "beebox/plugins/nope";\nexport const description = "Build a syllabus";\n');
await box.write("src/schemas/note-extra.ts", 'const dyn = await import("beebox/plugins/courseware");\n');
await scanStubImports(box.root)
=> [
  { file: "src/schemas/course.ts", plugin: "courseware" },
  { file: "src/tricks/scripts/syllabus/index.ts", plugin: "nope" },
  { file: "src/views/concept-map.tsx", plugin: "courseware" },
]
```

## Installed but inactive is a warning; unknown is an error

With `courseware` installed and nothing active, each courseware stub warns;
the trick's import of a plugin the engine does not have is an error.

```ts continue
const imports = await scanStubImports(box.root);
failing(stubImportChecks({ imports, installed: new Set(["courseware"]), active: new Set(), failures: [] }))
=> [
  { name: "plugin-stub-inactive", severity: "warning", message: 'src/schemas/course.ts imports beebox/plugins/courseware, which is installed but not active: its skill and lint are off. Add "courseware" to plugins in _config/box.json, or remove the stub.' },
  { name: "plugin-stub-inactive", severity: "warning", message: 'src/views/concept-map.tsx imports beebox/plugins/courseware, which is installed but not active: its skill and lint are off. Add "courseware" to plugins in _config/box.json, or remove the stub.' },
  { name: "plugin-stub-missing", severity: "error", message: "src/tricks/scripts/syllabus/index.ts imports beebox/plugins/nope, which this engine does not provide: `bbx plugins list` names the installed plugins. Its cards have no schema until the stub is fixed or removed." },
]
```

## A stub the schema loader could not load

The loader keeps the last good schema and records the failure
(`schema-load-status.ts`); this check surfaces that record for stub files, by
the loader's file name within `src/schemas/`.

```ts continue
const active = new Set(["courseware"]);
const failures = [{ file: "course.ts", message: "Cannot find package 'beebox/plugins/courseware'", at: "2026-10-10T00:00:00.000Z" }];
failing(stubImportChecks({ imports, installed: active, active, failures })).filter((c) => c.name === "plugin-stub-missing")
=> [
  { name: "plugin-stub-missing", severity: "error", message: "src/tricks/scripts/syllabus/index.ts imports beebox/plugins/nope, which this engine does not provide: `bbx plugins list` names the installed plugins. Its cards have no schema until the stub is fixed or removed." },
  { name: "plugin-stub-missing", severity: "error", message: "src/schemas/course.ts failed to load, so its card type is missing or stale: Cannot find package 'beebox/plugins/courseware'" },
]
```

With every import active and loading, both checks report ok:

```ts continue
stubImportChecks({ imports: imports.filter((i) => i.plugin === "courseware"), installed: active, active, failures: [] }).map((c) => `${c.name}:${c.ok ? "ok" : "FAIL"}`)
=> ["plugin-stub-inactive:ok", "plugin-stub-missing:ok"]
```

```ts cleanup
await box.cleanup();
```
