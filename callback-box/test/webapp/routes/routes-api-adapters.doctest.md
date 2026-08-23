# API adapters — authenticated provider pass-through for the frontend

`/api/adapters/:adapter/<path>` forwards to the provider with the box's
API key injected server-side (the machine secret store's entry of the same
name, falling back to the legacy
`config/connectors/<adapter>.secret.json`). Views call providers that
refuse CORS, and the key never reaches the browser. An adapter
declaration is a couple of lines (base URL + auth header shape).

```ts setup
import Fastify from "fastify";
import { makeTestServer } from "../../helpers/doctest-server.js";

// A fake upstream standing in for api.replicate.com.
const upstream = Fastify();
upstream.post("/v1/models/meta/llama/predictions", async (request) => {
  return {
    id: "pred-1",
    auth: request.headers["authorization"] ?? null,
    cookie: request.headers["cookie"] ?? null,
    echo: request.body,
  };
});
const upstreamUrl = await upstream.listen({ port: 0, host: "127.0.0.1" });
process.env["CB_ADAPTER_BASE_REPLICATE"] = upstreamUrl;
```

## Missing key → clear 503 naming the grant to ask for

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/adapters/replicate/v1/models/meta/llama/predictions",
  payload: { input: { prompt: "hi" } },
});
res.statusCode
=> 503

res.body.error
=> No API key for "replicate" — ask the boxholder to grant the "replicate" secret to this box (cb secrets set replicate; cb secrets grant <box> replicate)
```

## With a key: forwarded with auth injected, cookies stripped

```ts continue
await ctx.seed("config/connectors/replicate.secret.json", '{"apiKey": "r8_test_key"}');
const ok = await ctx.request({
  method: "POST",
  url: "/api/adapters/replicate/v1/models/meta/llama/predictions",
  payload: { input: { prompt: "hi" } },
  headers: { cookie: "session=secret" },
});
ok.statusCode
=> 200

ok.body.auth
=> Bearer r8_test_key

JSON.stringify(ok.body.cookie)
=> null

ok.body.echo.input.prompt
=> hi
```

## Unknown adapters enumerate the valid set

```ts continue
const nope = await ctx.request({ method: "POST", url: "/api/adapters/nope/v1/x", payload: {} });
nope.statusCode
=> 404

nope.body.error
=> Unknown adapter "nope" — available: replicate, mistral, anthropic, openai
```

```ts cleanup
await ctx.cleanup();
await upstream.close();
delete process.env["CB_ADAPTER_BASE_REPLICATE"];
```
