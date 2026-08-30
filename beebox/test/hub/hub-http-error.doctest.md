# Hub raw-route error sanitization

The hub owns public auth routes in production, so unexpected failures must be
logged server-side while their response remains generic.

```ts setup
import Fastify from "fastify";
import { registerHubErrorHandler } from "../../src/hub/hub-http-error.js";
```

```ts
const app = Fastify({ logger: false });
registerHubErrorHandler(app);
app.get("/explode", async () => {
  throw new Error("credential store failed at /srv/callback/.bbx-auth.json");
});
const originalError = console.error;
const logged = [];
console.error = (...args) => logged.push(args);
const response = await app.inject({ method: "GET", url: "/explode" });
console.error = originalError;
JSON.stringify({ status: response.statusCode, body: response.json(), logged: logged.length })
=> {"status":500,"body":{"error":"Internal server error"},"logged":1}
```

```ts cleanup
await app.close();
```
