# OpenRouter catalog and key usage

Admin validates an added model against OpenRouter's public catalog and shows
its price, then shows what the key has spent. Both reads are free; neither
leaves the machine here. The fixtures under `test/fixtures/openrouter/` are
trimmed real responses (recorded 2026-09-19), not hand-written guesses.

```ts setup
import { readFile } from "node:fs/promises";
import { clearOpenRouterCatalogCache, lookupOpenRouterModel, readOpenRouterKeyUsage } from "../../src/core/openrouter-catalog.js";

const fixture = async (name: string) => readFile(new URL(`../fixtures/openrouter/${name}`, import.meta.url), "utf8");
// Each section gets its own fake; nothing here may reach the global `fetch`.
const catalog = async () => serve(await fixture("models.json"));
const calls: string[] = [];
const serve = (body: string, status = 200) => async (url: string, init?: RequestInit) => {
  calls.push(`${url} auth=${new Headers(init?.headers).get("authorization") ?? "none"}`);
  return new Response(body, { status });
};
```

## A known model: tools, context, and price per million tokens

A `:variant` suffix is a routing choice on the same model, so it looks up the
base id. The catalog call carries no key.

```ts
clearOpenRouterCatalogCache();
JSON.stringify(await lookupOpenRouterModel("qwen/qwen3-coder:exacto", { fetch: await catalog(), now: 0 }))
=> {"ok":true,"found":true,"model":{"name":"Qwen: Qwen3 Coder 480B A35B","contextLength":262144,"supportsTools":true,"pricing":{"promptPerMTok":0.3,"completionPerMTok":1,"cacheReadPerMTok":0.1}}}

calls.at(-1)
=> https://openrouter.ai/api/v1/models auth=none
```

A model with no cache pricing reports null there, not zero.

```ts
(await lookupOpenRouterModel("moonshotai/kimi-k2-0905", { fetch: await catalog(), now: 0 })).ok
=> true

JSON.stringify((await lookupOpenRouterModel("moonshotai/kimi-k2-0905", { fetch: await catalog(), now: 0 })))
=> {"ok":true,"found":true,"model":{"name":"MoonshotAI: Kimi K2 0905","contextLength":262144,"supportsTools":true,"pricing":{"promptPerMTok":0.6,"completionPerMTok":2.5,"cacheReadPerMTok":null}}}
```

## A model without tool calling is found, and says so

Admin refuses it; the catalog only reports.

```ts
const noTools = await lookupOpenRouterModel("inference-net/schematron-v2-turbo", { fetch: await catalog(), now: 0 });
noTools.ok && noTools.found && noTools.model.supportsTools
=> false
```

## An unknown id is "not found", not an error

```ts
JSON.stringify(await lookupOpenRouterModel("deepseek/not-a-model", { fetch: await catalog(), now: 0 }))
=> {"ok":true,"found":false}
```

## The catalog is cached for an hour

A second lookup inside the hour reads the fetched catalog. An hour later it
fetches again.

```ts
clearOpenRouterCatalogCache();
const fetch = await catalog();
await lookupOpenRouterModel("qwen/qwen3-coder", { fetch, now: 0 });
const before = calls.length;
await lookupOpenRouterModel("qwen/qwen3-coder", { fetch, now: 59 * 60 * 1000 });
calls.length - before
=> 0

await lookupOpenRouterModel("qwen/qwen3-coder", { fetch, now: 61 * 60 * 1000 });
calls.length - before
=> 1
```

## A failed catalog read is an error the add form shows

```ts
clearOpenRouterCatalogCache();
JSON.stringify(await lookupOpenRouterModel("qwen/qwen3-coder", { fetch: serve("{}", 503), now: 0 }))
=> {"ok":false,"error":"https://openrouter.ai/api/v1/models answered HTTP 503"}

clearOpenRouterCatalogCache();
(await lookupOpenRouterModel("qwen/qwen3-coder", { fetch: serve(`{"data":"nope"}`), now: 0 })).ok
=> false
```

## Key usage

The key's own spend, across every use of the key. The key goes as a bearer
token.

```ts
JSON.stringify(await readOpenRouterKeyUsage("placeholder-key", { fetch: serve(await fixture("key.json")) }))
=> {"ok":true,"usage":{"totalUsd":4.753326683,"monthUsd":4.753326683,"limitUsd":10,"limitRemainingUsd":5.246673317,"limitReset":"monthly"}}

calls.at(-1)
=> https://openrouter.ai/api/v1/key auth=Bearer placeholder-key

JSON.stringify(await readOpenRouterKeyUsage("bad", { fetch: serve("{}", 401) }))
=> {"ok":false,"error":"https://openrouter.ai/api/v1/key answered HTTP 401"}
```
