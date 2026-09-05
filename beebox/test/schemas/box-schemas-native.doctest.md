# Box-Local Schemas: native resolution in the box package

A box keeps its code at the box root's `src/` (one-root layout, see
`docs/plans/one-root-box-layout.md`). `loadBoxSchemas` resolves the schemas
dir from `getBoxShape`/`boxCodePaths`, and the box's own
`node_modules/beebox` (installed like any other dependency) serves
`beebox/cards` and `beebox/schema` via **native** Node module resolution —
no resolve hooks, no synthesized `package.json`.

We can't run a real `pnpm install` in a doctest, so we use the same trick
`bbx view test` uses to prove native resolution against the real package
(`src/cli/commands/view.ts`): symlink `node_modules/beebox` straight
at the engine's own `PACKAGE_ROOT`. A schema file importing
`beebox/cards` / `beebox/schema` through that symlink is
resolving through the package's real `exports` map, exactly as an
installed dependency would.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { PACKAGE_ROOT } from "../../src/lib/package-root.js";
import {
  loadBoxSchemas,
  invalidateBoxSchemas,
} from "../../src/schemas/registry.js";
import { listSchemaLoadFailures } from "../../src/schemas/schema-load-status.js";
import {
  getBoxShape,
  findLegacySchemaFiles,
  describeLegacySchemaFiles,
} from "../../src/lib/box-shape.js";

/**
 * A one-root (shapeVersion 3) box fixture: `<root>/package.json` (declaring
 * beebox), `<root>/node_modules/beebox` symlinked to the real engine
 * package root, and `<root>/.beebox/box.json` marking the box root. Schema
 * files go under `<root>/src/schemas/`. `root` and `boxRoot` are the same
 * directory — both returned so examples read naturally.
 */
async function makeV3Box() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-v3box-"));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "my-box", private: true, type: "module", dependencies: { "beebox": "0.1.0" } }),
  );
  await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
  await fs.symlink(PACKAGE_ROOT, path.join(root, "node_modules", "beebox"), "dir");
  await fs.mkdir(path.join(root, ".beebox"), { recursive: true });
  await fs.writeFile(path.join(root, ".beebox/box.json"), JSON.stringify({ shapeVersion: 3 }));
  return { root, boxRoot: root };
}

async function writeSchema(root, relPath, content) {
  const full = path.join(root, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
}

// Imports the public exports surface exactly the way a real box schema
// would — no zod/yaml bare specifiers.
const V2_WIDGET_SCHEMA = `import { body, cardSchema } from "beebox/cards";
import { z } from "beebox/schema";

export default cardSchema("widget", {
  fields: {
    size: z.number(),
    body: body(z.string()),
  },
});
`;

const V2_WIDGET_SCHEMA_BROKEN = `import { cardSchema } from "beebox/cards";
export default cardSchema(`;

// There is no resolve-hook fakery: a bare `zod` import (as opposed to
// `beebox/schema`) has nothing to resolve against.
const V2_SCHEMA_WITH_BARE_ZOD = `import { cardSchema } from "beebox/cards";
import { z } from "zod";

export default cardSchema("widget", { fields: { size: z.number() } });
`;
```

## A box's `src/schemas/*.ts` loads via native resolution

```ts
const { root, boxRoot } = await makeV3Box();
await writeSchema(root, "src/schemas/widget.ts", V2_WIDGET_SCHEMA);

const loaded = await loadBoxSchemas(boxRoot);
[loaded.cardSchemas.length, loaded.cardSchemas[0].type].join("|")
=> 1|widget
```

```ts cleanup
await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
```

## Keep-last-good still applies to a broken save

```ts
const { root, boxRoot } = await makeV3Box();
const schemaPath = path.join(root, "src/schemas/widget.ts");
await writeSchema(root, "src/schemas/widget.ts", V2_WIDGET_SCHEMA);
const good = await loadBoxSchemas(boxRoot);
good.cardSchemas.map(s => s.type).join(",")
=> widget

await fs.writeFile(schemaPath, V2_WIDGET_SCHEMA_BROKEN);
invalidateBoxSchemas(boxRoot);
const kept = await loadBoxSchemas(boxRoot);
kept.cardSchemas.map(s => s.type).join(",")
=> widget
```

The failure is no longer silent — `bbx status`/`/healthz`'s
`listSchemaLoadFailures` reports it even though the type kept serving its
last-good version:

```ts continue
const failures = listSchemaLoadFailures(boxRoot);
[failures.length, failures[0].file].join("|")
=> 1|widget.ts
```

```ts cleanup
await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
```

## A bare `zod`/`yaml` import fails — only `beebox/*` specifiers resolve

```ts
const { root, boxRoot } = await makeV3Box();
await writeSchema(root, "src/schemas/widget.ts", V2_SCHEMA_WITH_BARE_ZOD);

const loaded = await loadBoxSchemas(boxRoot);
const failures = listSchemaLoadFailures(boxRoot);
[loaded.cardSchemas.length, failures.length > 0].join("|")
=> 0|true
```

```ts cleanup
await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
```

## A schema left in the legacy `_config/schemas/` location is flagged

`_config/schemas/` is the legacy schema location — the loader never reads it
(schemas live in `src/schemas/` at the box root) and it's not a card path
the validate hook checks — so a stray file there would otherwise load
silently nowhere. `findLegacySchemaFiles` catches it for
`bbx validate`/`bbx status`:

```ts
const { root, boxRoot } = await makeV3Box();
await writeSchema(boxRoot, "_config/schemas/stray.ts", V2_WIDGET_SCHEMA);

const shape = await getBoxShape(boxRoot);
const legacyFiles = await findLegacySchemaFiles(shape);
legacyFiles.join(",")
=> stray.ts
```

```ts continue
describeLegacySchemaFiles(shape, legacyFiles).includes("src/schemas/")
=> true
```

```ts cleanup
await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
```
