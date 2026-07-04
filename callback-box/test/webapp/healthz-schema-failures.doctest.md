# `/healthz` surfaces box-local schema load failures

Keep-last-good (`loadOneSchemaFile` in `src/schemas/registry.ts`) means a
box-local schema file that fails to (re-)load keeps serving its previous
good version rather than dropping the card type — but that used to make
the failure itself invisible (`console.warn` only). `/healthz` now rolls up
`listSchemaLoadFailures` per box, the same way it already rolls up parked
template updates.

```ts setup
import { makeTestServer, TEST_SLUG } from "../helpers/doctest-server.js";
import * as path from "node:path";
import { loadBoxSchemas, invalidateBoxSchemas } from "../../src/schemas/registry.js";

const GOOD_SCHEMA = `import { cardSchema } from "callback-box/cards";
import { z } from "callback-box/schema";

export default cardSchema("widget", { fields: { size: z.number() } });
`;

const BROKEN_SCHEMA = `import { cardSchema } from "callback-box/cards";
export default cardSchema(`;

process.env.CB_DIAG_API_KEY = "test-diag-key";
```

```ts
const server = await makeTestServer();
await server.seed("config/schemas/widget.ts", GOOD_SCHEMA);
await loadBoxSchemas(server.boxRoot); // populate this process's in-memory schema state, as the server would on box registration

const headers = { authorization: "Bearer test-diag-key" };
const clean = await server.rootRequest({ method: "GET", url: "/healthz", headers });
JSON.stringify(clean.body.schemaLoadFailures)
=> {"total":0,"byBox":{}}
```

```ts continue
await server.seed("config/schemas/widget.ts", BROKEN_SCHEMA);
invalidateBoxSchemas(server.boxRoot);
await loadBoxSchemas(server.boxRoot);

const broken = await server.rootRequest({ method: "GET", url: "/healthz", headers });
JSON.stringify(broken.body.schemaLoadFailures)
=> {"total":1,"byBox":{"test":1}}
```

```ts cleanup
delete process.env.CB_DIAG_API_KEY;
await server.cleanup();
```
