# OpenRouter chat models run only when the owner added them

OpenRouter models bill per use, so a box never runs one because a key
happens to exist. The owner adds each model in admin (`openrouterModels` in
box config), and every spawn checks both that list and the key
(`docs/plans/openrouter-chat-models.md`). These tests are the gate.

```ts setup
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chatModelForEngine, chatModelLabel, chatModelOptions, isChatModelAllowed, isOpenRouterModelId } from "../../src/shared/chat-models.js";
import { providerOf, resolveProcedureModel } from "../../src/shared/agent-models.js";
import { resolveEffectiveModel, resolveSmallModelForEngine } from "../../src/core/model-policy.js";
import { loadAddedModels, loadBoxModel, loadSmallModel } from "../../src/core/box/config.js";
import { isThirdPartyModel, providerEnvAdditions } from "../../src/core/provider-env.js";
import { openRouterChatEnv, OpenRouterSetupError } from "../../src/core/openrouter-chat.js";
import { ProviderSetupError } from "../../src/core/provider-setup-error.js";
import { grantSecret, setSecret } from "../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../src/lib/box-slug.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const kimi = { id: "moonshotai/kimi-k2-0905:exacto", label: "Kimi K2" };

async function boxWith(config: Record<string, unknown>) {
  process.env.BBX_SECRETS_FILE = join(await mkdtemp(join(tmpdir(), "bbx-secrets-")), "secrets.json");
  const box = await makeTmpBox();
  await mkdir(join(box.root, "_config"), { recursive: true });
  await writeFile(join(box.root, "_config/box.json"), JSON.stringify(config));
  return box;
}

async function grantKey(boxRoot: string) {
  await setSecret({ name: "openrouter", value: "placeholder-openrouter-key" });
  await grantSecret({ slug: await boxSlug(boxRoot), name: "openrouter", access: "server" });
}

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "no refusal";
  } catch (e) {
    return e instanceof ProviderSetupError ? `${e.name}: ${e.message}` : `unexpected: ${String(e)}`;
  }
}
```

## The id shape names the provider

OpenRouter ids are `author/slug`, with an optional `:variant`. No first-party,
Codex, or GLM id contains a slash, so the slash alone is the provider rule.

```ts
JSON.stringify(["deepseek/deepseek-v3.2", kimi.id, "glm-5.3", "claude-opus-5", "gpt-5.6-sol"].map(providerOf))
=> ["openrouter","openrouter","glm","anthropic","openai"]

JSON.stringify([isOpenRouterModelId(kimi.id), isOpenRouterModelId("deepseek"), isOpenRouterModelId("Deep/Seek"), isOpenRouterModelId("a/b:c:d")])
=> [true,false,false,false]
```

## The static menu never offers one; the added list does

An empty list is the default for every box. Only claude chats take added
models — they ride its Anthropic-shaped transport.

```ts
isChatModelAllowed("claude", { model: kimi.id, added: [] })
=> false

isChatModelAllowed("claude", { model: kimi.id, added: [kimi] })
=> true

isChatModelAllowed("codex", { model: kimi.id, added: [kimi] })
=> false

chatModelOptions("claude", [kimi]).at(-1)?.label
=> Kimi K2
```

## A removed pick is kept, not quietly replaced

A chat that explicitly picked a model the owner later removed keeps that pick.
Following the box default instead would change who answers without anyone
choosing it; the spawn refuses with the fix (below). A follower is unaffected.

```ts
JSON.stringify([
  resolveEffectiveModel({ engine: "claude", pinned: "claude-sonnet-5", added: [] }, { kind: "explicit", model: kimi.id }),
  resolveEffectiveModel({ engine: "claude", pinned: "claude-sonnet-5", added: [] }, { kind: "follow" }),
])
=> [{"model":"moonshotai/kimi-k2-0905:exacto","source":"explicit"},{"model":"claude-sonnet-5","source":"default"}]

chatModelForEngine("claude", kimi.id)
=> moonshotai/kimi-k2-0905:exacto

chatModelLabel("claude", { model: kimi.id, added: [] })
=> moonshotai/kimi-k2-0905:exacto (removed in admin)
```

## Tiered work stays first-party

An added model has no tier. On a box whose default is an OpenRouter model, a
procedure step that asks for `strong` and the cheap structured passes resolve
to first-party Claude — the boxholder's call (2026-09-19): only the model the
owner chose spends per use.

```ts
JSON.stringify([
  resolveProcedureModel({ engine: "claude", model: "strong", provider: providerOf(kimi.id) }),
  resolveSmallModelForEngine({ engine: "claude", pinned: null, boxDefault: kimi.id }),
])
=> ["claude-opus-5","claude-haiku-4-5-20251001"]
```

## Box config: the list, the default, and the small slot

A malformed entry is dropped with a warning; the rest survive. An added model
may be the box default. It may never be the small-pass model.

```ts
const box = await boxWith({
  agentModel: kimi.id,
  smallModel: kimi.id,
  openrouterModels: [kimi, { id: "not an id", label: "x" }, { id: "qwen/qwen3-coder", label: "" }, { ...kimi, label: "dup" }],
});
JSON.stringify(await loadAddedModels(box.root))
=> [{"id":"moonshotai/kimi-k2-0905:exacto","label":"Kimi K2"}]

await loadBoxModel(box.root)
=> moonshotai/kimi-k2-0905:exacto

await loadSmallModel(box.root)
=> null

await box.cleanup();
```

A default that names a model no longer in the list is not a policy the box
can run, so it reads as none.

```ts
const box = await boxWith({ agentModel: kimi.id });
await loadBoxModel(box.root)
=> null

await box.cleanup();
```

## The spawn gate

`providerEnvAdditions` is what every spawn path calls. A first-party model
needs nothing.

```ts
const box = await boxWith({});
JSON.stringify([
  await providerEnvAdditions({ boxRoot: box.root, model: "claude-opus-5", purpose: "test" }),
  await providerEnvAdditions({ boxRoot: box.root, model: null, purpose: "test" }),
  isThirdPartyModel("claude-opus-5"),
  isThirdPartyModel(kimi.id),
])
=> [null,null,false,true]

await box.cleanup();
```

A key alone runs nothing. The refusal names where to add the model.

```ts
const box = await boxWith({});
await grantKey(box.root);
await refusal(() => providerEnvAdditions({ boxRoot: box.root, model: kimi.id, purpose: "test" }))
=> OpenRouterSetupError: This run uses the OpenRouter model moonshotai/kimi-k2-0905:exacto, which is not added for this box. Add it in Admin → OpenRouter models, or pick another model.

await box.cleanup();
```

An added model without a key refuses too, naming the key setup.

```ts
const box = await boxWith({ openrouterModels: [kimi] });
(await refusal(() => providerEnvAdditions({ boxRoot: box.root, model: kimi.id, purpose: "test" }))).startsWith("OpenRouterSetupError: This run uses the OpenRouter model moonshotai/kimi-k2-0905:exacto, but no usable OpenRouter key")
=> true

await box.cleanup();
```

Both present: the run gets the endpoint, the key, a blank `ANTHROPIC_API_KEY`,
and every Claude Code model role pinned to the chosen model, so no background
call goes out under a `claude-*` id on this key.

```ts
const box = await boxWith({ openrouterModels: [kimi] });
await grantKey(box.root);
const env: Record<string, string | undefined> = { KEEP: "yes" };
const additions = await providerEnvAdditions({ boxRoot: box.root, model: kimi.id, purpose: "test", env });
JSON.stringify(additions) === JSON.stringify(openRouterChatEnv({ key: "placeholder-openrouter-key", model: kimi.id }))
=> true

JSON.stringify([env.KEEP, env.ANTHROPIC_BASE_URL, env.ANTHROPIC_API_KEY, env.ANTHROPIC_DEFAULT_HAIKU_MODEL, env.CLAUDE_CODE_SUBAGENT_MODEL])
=> ["yes","https://openrouter.ai/api","","moonshotai/kimi-k2-0905:exacto","moonshotai/kimi-k2-0905:exacto"]

await box.cleanup();
```

`OpenRouterSetupError` and GLM's key error share one base, so every spawn
path refuses both the same way.

```ts
new OpenRouterSetupError("x") instanceof ProviderSetupError
=> true
```
