# Admin: adding and removing OpenRouter chat models

Adding a model in admin is the only way a box can run one
(`docs/plans/openrouter-chat-models.md`). The add is checked against
OpenRouter's catalog; removal refuses while the model is the box default. The
catalog and key responses here are the recorded fixtures, served through the
`openrouterFetch` service so nothing leaves the machine.

```ts setup
import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTestServer } from "../helpers/doctest-server.js";
import { clearBoxConfigCache } from "../../src/core/box/config.js";
import { clearOpenRouterCatalogCache } from "../../src/core/openrouter-catalog.js";
import { grantSecret, setSecret } from "../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../src/lib/box-slug.js";

const fixture = async (name: string) => readFile(new URL(`../fixtures/openrouter/${name}`, import.meta.url), "utf8");
const models = await fixture("models.json");
const key = await fixture("key.json");
async function openrouterFetch(url: string) {
  return new Response(url.endsWith("/key") ? key : models, { status: 200 });
}

function caller(server, opts) {
  return appRouter.createCaller({
    boxRoot: server.boxRoot,
    boxSlug: "test",
    eventBus: server.eventBus,
    services: { openrouterFetch },
    user: null,
    authed: true,
    isOwner: opts?.isOwner !== false,
  });
}

async function message(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "ok";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
```

## An empty box: no models, no key

```ts
process.env.BBX_SECRETS_FILE = join(await mkdtemp(join(tmpdir(), "bbx-secrets-")), "secrets.json");
clearOpenRouterCatalogCache();
const server = await makeTestServer();
JSON.stringify(await caller(server).admin.openrouterModels())
=> {"keyGranted":false,"usage":null,"models":[]}
```

## Adding validates against the catalog

A typo, an id OpenRouter does not carry, and a model with no tool calling are
all refused here, before any chat could try them.

```ts continue
await message(() => caller(server).admin.addOpenrouterModel({ id: "DeepSeek V3", label: "x" }))
=> Enter an OpenRouter model id like deepseek/deepseek-v3.2 (lowercase, author/model) and a label of at most 60 characters.

await message(() => caller(server).admin.addOpenrouterModel({ id: "deepseek/not-a-model", label: "x" }))
=> OpenRouter has no model deepseek/not-a-model. Check the id on openrouter.ai/models.

await message(() => caller(server).admin.addOpenrouterModel({ id: "inference-net/schematron-v2-turbo", label: "x" }))
=> inference-net/schematron-v2-turbo does not support tool calling, which every chat and agent turn needs.
```

A valid model is saved with its label and listed with its price.

```ts continue
await caller(server).admin.addOpenrouterModel({ id: "moonshotai/kimi-k2-0905:exacto", label: " Kimi K2 " });
clearBoxConfigCache(server.boxRoot);
const listed = (await caller(server).admin.openrouterModels()).models[0];
JSON.stringify([listed.id, listed.label, listed.catalog.ok && listed.catalog.found && listed.catalog.model.pricing.promptPerMTok])
=> ["moonshotai/kimi-k2-0905:exacto","Kimi K2",0.6]
```

## The added model can be the box default, and then cannot be removed

```ts continue
await caller(server).admin.updateBoxConfig({ agentModel: "moonshotai/kimi-k2-0905:exacto" });
clearBoxConfigCache(server.boxRoot);
(await caller(server).admin.boxConfig()).agentModel
=> moonshotai/kimi-k2-0905:exacto

await message(() => caller(server).admin.removeOpenrouterModel({ id: "moonshotai/kimi-k2-0905:exacto" }))
=> moonshotai/kimi-k2-0905:exacto is this box's default model. Change the default model first, then remove it.
```

An id that was never added cannot become the default.

```ts continue
await message(() => caller(server).admin.updateBoxConfig({ agentModel: "qwen/qwen3-coder" }))
=> Unknown model id qwen/qwen3-coder
```

Once the default moves, removal works and the list is empty again.

```ts continue
await caller(server).admin.updateBoxConfig({ agentModel: null });
await caller(server).admin.removeOpenrouterModel({ id: "moonshotai/kimi-k2-0905:exacto" });
clearBoxConfigCache(server.boxRoot);
(await caller(server).admin.openrouterModels()).models.length
=> 0
```

## With a key: the key's usage, and the picker sees added models

`chat.status` offers added models only when the key is usable — rows whose
every run would refuse are noise.

```ts continue
await caller(server).admin.addOpenrouterModel({ id: "qwen/qwen3-coder", label: "Qwen3 Coder" });
clearBoxConfigCache(server.boxRoot);
(await caller(server).chat.status({})).addedModels.length
=> 0

await setSecret({ name: "openrouter", value: "placeholder-openrouter-key" });
await grantSecret({ slug: await boxSlug(server.boxRoot), name: "openrouter", access: "server" });
JSON.stringify((await caller(server).chat.status({})).addedModels)
=> [{"id":"qwen/qwen3-coder","label":"Qwen3 Coder"}]

const withKey = await caller(server).admin.openrouterModels();
JSON.stringify([withKey.keyGranted, withKey.usage])
=> [true,{"ok":true,"usage":{"totalUsd":4.753326683,"monthUsd":4.753326683,"limitUsd":10,"limitRemainingUsd":5.246673317,"limitReset":"monthly"}}]
```

## Owner only

```ts continue
await message(() => caller(server, { isOwner: false }).admin.addOpenrouterModel({ id: "qwen/qwen3-coder", label: "x" }))
=> Owner access required
```

```ts cleanup
await server.cleanup();
```
