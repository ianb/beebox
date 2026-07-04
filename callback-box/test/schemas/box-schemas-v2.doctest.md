# Box-Local Schemas: v2 (package-layout) boxes

A shapeVersion 2 box moves its code out of the operational root into a
package root's `src/` (see "The box repository" in
`docs/plans/boxes-as-packages-v2.md`). `loadBoxSchemas` resolves the
schemas dir from `getBoxShape`/`boxCodePaths` instead of a hardcoded
`config/schemas`, and for v2 boxes it skips the v1 resolve-hook fakery
entirely: the box's own `node_modules/callback-box` (installed like any
other dependency) serves `callback-box/cards` and `callback-box/schema` via
**native** Node module resolution — no `registerHooks`, no synthesized
`package.json`.

We can't run a real `pnpm install` in a doctest, so we use the same trick
`cb view test` uses to prove native resolution against the real package
(`src/cli/commands/view.ts`): symlink `node_modules/callback-box` straight
at the engine's own `PACKAGE_ROOT`. A schema file importing
`callback-box/cards` / `callback-box/schema` through that symlink is
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
} from "../../src/cli/lib/box-shape.js";

/**
 * A v2 box fixture: `<root>/package.json` (declaring callback-box),
 * `<root>/node_modules/callback-box` symlinked to the real engine package
 * root, and `<root>/content/.cb-box` marking the operational root. Returns
 * the content dir (the box root proper) plus the package root for writing
 * schema files under `src/schemas/`.
 */
async function makeV2Box() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cb-v2box-"));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "my-box", private: true, type: "module", dependencies: { "callback-box": "0.1.0" } }),
  );
  await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
  await fs.symlink(PACKAGE_ROOT, path.join(root, "node_modules", "callback-box"), "dir");
  const contentDir = path.join(root, "content");
  await fs.mkdir(contentDir, { recursive: true });
  await fs.writeFile(path.join(contentDir, ".cb-box"), JSON.stringify({ shapeVersion: 2 }));
  return { root, boxRoot: contentDir };
}

async function writeSchema(root, relPath, content) {
  const full = path.join(root, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
}

// Imports the public exports surface exactly the way a real box schema
// would — no zod/yaml bare specifiers.
const V2_WIDGET_SCHEMA = `import { body, cardSchema } from "callback-box/cards";
import { z } from "callback-box/schema";

export default cardSchema("widget", {
  fields: {
    size: z.number(),
    body: body(z.string()),
  },
});
`;

const V2_WIDGET_SCHEMA_BROKEN = `import { cardSchema } from "callback-box/cards";
export default cardSchema(`;

// v2 boxes don't get the resolve-hook fakery: a bare `zod` import (as
// opposed to `callback-box/schema`) has nothing to resolve against.
const V2_SCHEMA_WITH_BARE_ZOD = `import { cardSchema } from "callback-box/cards";
import { z } from "zod";

export default cardSchema("widget", { fields: { size: z.number() } });
`;
```

## A v2 box's `src/schemas/*.ts` loads via native resolution (no resolve hook)

```ts
const { root, boxRoot } = await makeV2Box();
await writeSchema(root, "src/schemas/widget.ts", V2_WIDGET_SCHEMA);

const loaded = await loadBoxSchemas(boxRoot);
[loaded.cardSchemas.length, loaded.cardSchemas[0].type].join("|")
=> 1|widget
```

```ts cleanup
await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
```

## Keep-last-good still applies to a v2 box's broken save

```ts
const { root, boxRoot } = await makeV2Box();
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

The failure is no longer silent — `cb status`/`/healthz`'s
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

## A bare `zod`/`yaml` import fails in a v2 box — only `callback-box/*` specifiers resolve

```ts
const { root, boxRoot } = await makeV2Box();
await writeSchema(root, "src/schemas/widget.ts", V2_SCHEMA_WITH_BARE_ZOD);

const loaded = await loadBoxSchemas(boxRoot);
const failures = listSchemaLoadFailures(boxRoot);
[loaded.cardSchemas.length, failures.length > 0].join("|")
=> 0|true
```

```ts cleanup
await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
```

## A schema left in the legacy `config/schemas/` location on a v2 box is flagged

`config/schemas/` is where a *legacy* (shapeVersion 1) box's schemas live.
On a v2 box it's not read by the loader at all (schemas live in
`src/schemas/` at the package root) and it's not a card path the validate
hook checks — so a stray file there would otherwise load silently nowhere.
`findLegacySchemaFiles` catches it for `cb validate`/`cb status`:

```ts
const { root, boxRoot } = await makeV2Box();
await writeSchema(boxRoot, "config/schemas/stray.ts", V2_WIDGET_SCHEMA);

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

A v1 (legacy) box's `config/schemas/` is the *correct* location, so the
same check never flags it there:

```ts
const { makeTmpBox } = await import("../helpers/doctest-helpers.js");
const legacyBox = await makeTmpBox();
await writeSchema(legacyBox.root, "config/schemas/widget.ts", V2_WIDGET_SCHEMA);
const legacyShape = await getBoxShape(legacyBox.root);
(await findLegacySchemaFiles(legacyShape)).length
=> 0
```

```ts cleanup
await legacyBox.cleanup();
```
