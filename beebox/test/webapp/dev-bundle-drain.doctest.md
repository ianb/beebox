# Development bundle drain gate

The server-wide gate counts a mutation before route-level async preparation,
then rejects newly arriving mutations once a reload begins.

```ts setup
import { createTestServer } from "../helpers/test-server.js";
import { beginDevBundleDrain, hasActiveMutations } from "../../src/lib/dev-bundle-reload.js";

const ctx = await createTestServer();
let releaseProbe;
const probeGate = new Promise((resolve) => { releaseProbe = resolve; });
ctx.server.post("/mutation-probe", async () => {
  await probeGate;
  return { ok: true };
});
```

```ts
const pending = ctx.server.inject({ method: "POST", url: "/mutation-probe" });
await new Promise((resolve) => setTimeout(resolve, 10));
hasActiveMutations()
=> true

releaseProbe();
(await pending).statusCode
=> 200

hasActiveMutations()
=> false
```

```ts
beginDevBundleDrain();
const rejected = await ctx.server.inject({ method: "POST", url: "/mutation-probe" });
JSON.stringify({ status: rejected.statusCode, body: rejected.json() })
=> {"status":503,"body":{"error":"Server is reloading updated development code; retry this request."}}
```

```ts cleanup
await ctx.cleanup();
```
