# `/healthz` surfaces box-local schema load failures

Keep-last-good (`loadOneSchemaFile` in `src/schemas/registry.ts`) means a
box-local schema file that fails to (re-)load keeps serving its previous
good version rather than dropping the card type — but that used to make
the failure itself invisible (`console.warn` only). `/healthz` now rolls up
`listSchemaLoadFailures` per box, the same way it already rolls up parked
template updates.

`listSchemaLoadFailures` only reflects whatever `loadBoxSchemas` has already
populated in this process — and box registration only starts the schema
*watcher* (`ensureSchemaWatcher`), it never calls `loadBoxSchemas` itself. So
`/healthz` loads box schemas itself before reading the failure snapshot
(mirroring `bbx status`); this doctest never primes the cache by hand, so a
regression back to "just read the map" would show up as a false `total: 0`
below.

```ts setup
import { makeTestServer, TEST_SLUG } from "../helpers/doctest-server.js";
import * as path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { invalidateBoxSchemas } from "../../src/schemas/registry.js";

// Box-local schemas live at `<packageRoot>/src/schemas/` for a v2 box — one
// level up from the operational box root — resolved natively through the
// box's own `node_modules/beebox` (the test server scaffolds it).
async function writeSchema(server, name, content) {
  const full = path.join(path.dirname(server.boxRoot), "src/schemas", name);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content);
}

const GOOD_SCHEMA = `import { cardSchema } from "beebox/cards";
import { z } from "beebox/schema";

export default cardSchema("widget", { fields: { size: z.number() } });
`;

const BROKEN_SCHEMA = `import { cardSchema } from "beebox/cards";
export default cardSchema(`;

process.env.BBX_DIAG_API_KEY = "test-diag-key";
```

```ts
const server = await makeTestServer();
await writeSchema(server, "widget.ts", GOOD_SCHEMA);

const headers = { authorization: "Bearer test-diag-key" };
const clean = await server.rootRequest({ method: "GET", url: "/healthz", headers });
JSON.stringify(clean.body.schemaLoadFailures)
=> {"total":0,"byBox":{}}
```

A schema edited to a broken state is picked up on the very next `/healthz`
call — with no other code path having loaded schemas for this box first:

```ts continue
await writeSchema(server, "widget.ts", BROKEN_SCHEMA);
invalidateBoxSchemas(server.boxRoot);

const broken = await server.rootRequest({ method: "GET", url: "/healthz", headers });
JSON.stringify(broken.body.schemaLoadFailures)
=> {"total":1,"byBox":{"test":1}}
```

```ts cleanup
delete process.env.BBX_DIAG_API_KEY;
await server.cleanup();
```
