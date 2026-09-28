# `/healthz` surfaces engine version mismatches (Track E, chunk E2)

A v2 box pins its own `beebox` dependency; `/healthz` rolls up any box
whose pinned version differs from the engine actually serving it, the same
way it already rolls up parked template updates and schema load failures.
The comparison itself lives in `getEngineVersionReport`
(`src/core/engine-version.js`), covered directly by
`test/core/engine-version.doctest.md` — this doctest only checks the field
is wired into the route.

A test box with no separately-installed engine — what `makeTestServer`
scaffolds (a v2 box without a `node_modules/beebox`) — reports a null
installed version, so it never contributes a mismatch:

```ts setup
import { makeTestServer } from "../helpers/doctest-server.js";

process.env.BBX_DIAG_API_KEY = "test-diag-key";
```

```ts
const server = await makeTestServer();
const headers = { authorization: "Bearer test-diag-key" };
const response = await server.rootRequest({ method: "GET", url: "/healthz", headers });
JSON.stringify(response.body.engineVersionMismatch)
=> {"total":0,"byBox":{}}
```

```ts cleanup
delete process.env.BBX_DIAG_API_KEY;
await server.cleanup();
```
