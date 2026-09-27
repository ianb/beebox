# A long tRPC batch routes

A batched GET names every procedure in its URL path, and the server routes
that list as one Fastify parameter. The client splits a batch only past
`TRPC_MAX_URL_LENGTH`, so the server must route any procedure list up to that
length. At a smaller server limit, a page that refreshed many queries at once
got `404 {"error":"Not found"}` for the whole batch.

```ts setup
import { makeTestServer } from "../helpers/doctest-server.js";
import { TRPC_MAX_URL_LENGTH } from "../../src/shared/trpc-url-limit.js";

const box = await makeTestServer();
```

A batch of `health.check` calls whose procedure list is just under the
client's URL limit routes and answers every call.

```ts
const names = [];
while ((names.length + 1) * "health.check,".length < TRPC_MAX_URL_LENGTH - 100) names.push("health.check");
const list = names.join(",");
list.length > 1500
=> true

const res = await box.request({ method: "GET", url: `/api/trpc/${list}?batch=1&input=%7B%7D` });
JSON.stringify([res.statusCode, Array.isArray(res.body) && res.body.length === names.length])
=> [200,true]

await box.cleanup();
```
