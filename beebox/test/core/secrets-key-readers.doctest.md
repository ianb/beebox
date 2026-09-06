# The single-string key readers

Three readers share the `mistral-key.ts` template. Each resolves one store entry
at `server` access and has no other source
(`docs/implemented-plans/secret-custody.md`):

| Reader | Store name |
|---|---|
| `core/gemini-key.ts` | `gemini` |
| `core/openai-thinking-key.ts` | `openai-thinking` |
| `core/search/embeddings-key.ts` | `openai` |

`openai` and `openai-thinking` are deliberately two names for two keys: a
transcription key was never consent to pay for embeddings.

Every value below is an obvious placeholder.

```ts setup
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getGeminiApiKey } from "../../src/core/gemini-key.js";
import { getOpenAiThinkingKey } from "../../src/core/openai-thinking-key.js";
import { getOpenAiEmbeddingsKey } from "../../src/core/search/embeddings-key.js";
import { grantSecret, revokeSecret, setSecret } from "../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../src/lib/box-slug.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

async function useTempStore() {
  const dir = await mkdtemp(join(tmpdir(), "bbx-secrets-"));
  process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
  return dir;
}
```

## The grant is the per-box opt-in

A secret merely *present* on the machine changes nothing for a box. The env vars
these readers used to accept are exported below to show they no longer
participate — a developer machine may genuinely have them set, and that must not
change what a box resolves.

```ts
const dir = await useTempStore();
const box = await makeTmpBox();
const slug = await boxSlug(box.root);

process.env.GEMINI_KEY = "placeholder-env-key";
process.env.SKE_GEMINI_API_KEY = "placeholder-legacy-env-key";
print(`env vars only: ${await getGeminiApiKey(box.root, { purpose: "gemini-vision", observe: true })}`);

await setSecret({ name: "gemini", value: "placeholder-store-key" });
print(`stored but ungranted: ${await getGeminiApiKey(box.root, { purpose: "gemini-vision", observe: true })}`);

await grantSecret({ slug, name: "gemini", access: "server" });
print(`store granted: ${await getGeminiApiKey(box.root, { purpose: "gemini-vision", observe: true })}`);
=>
env vars only: null
stored but ungranted: null
store granted: placeholder-store-key
```

## The thinking key is its own name

Granting `openai` does not configure `openai-thinking`, and vice versa.

```ts continue
process.env.THINKING_OPENAI_API_KEY = "placeholder-thinking-env-key";
await setSecret({ name: "openai", value: "placeholder-embeddings-store-key" });
await grantSecret({ slug, name: "openai", access: "server" });
print(`thinking key with only "openai" granted: ${await getOpenAiThinkingKey(box.root, { observe: true })}`);

await setSecret({ name: "openai-thinking", value: "placeholder-thinking-store-key" });
await grantSecret({ slug, name: "openai-thinking", access: "server" });
print(`thinking key granted: ${await getOpenAiThinkingKey(box.root, { observe: true })}`);
print(`embeddings key still: ${await getOpenAiEmbeddingsKey(box.root)}`);
=>
thinking key with only "openai" granted: null
thinking key granted: placeholder-thinking-store-key
embeddings key still: placeholder-embeddings-store-key
```

## Revoking a grant stops the key, whatever else is lying around

This is the property the transition window could not offer. A stray
`openai.secret.json` and an exported `BBX_OPENAI_API_KEY` are both put in place
first, so what the revoke has to survive is explicit.

```ts continue
await box.write("_config/connectors/openai.secret.json", JSON.stringify({ apiKey: "placeholder-file-key" }));
process.env.BBX_OPENAI_API_KEY = "placeholder-fallback-env-key";
await revokeSecret({ slug, name: "openai" });
print(`revoked, file and env still present: ${await getOpenAiEmbeddingsKey(box.root)}`);

// A store that cannot be read at all is a machine fault, and reads as not
// configured rather than as licence to use the credentials it superseded.
const corruptStore = join(dir, "corrupt-store.json");
await writeFile(corruptStore, "{ this is not json");
process.env.BBX_SECRETS_FILE = corruptStore;
print(`corrupt store, file and env still present: ${await getOpenAiEmbeddingsKey(box.root)}`);

// No store on the machine at all — the case the fallbacks used to serve.
process.env.BBX_SECRETS_FILE = join(dir, "no-store-here.json");
print(`no entry anywhere: ${await getOpenAiEmbeddingsKey(box.root)}`);
=>
revoked, file and env still present: null
corrupt store, file and env still present: null
no entry anywhere: null
```

Nothing configured is `null` for all three — the callers' existing "not
configured" path, never a throw:

```ts continue
JSON.stringify([
  await getGeminiApiKey(box.root, { purpose: "gemini-vision", observe: true }),
  await getOpenAiThinkingKey(box.root, { observe: true }),
  await getOpenAiEmbeddingsKey(box.root),
])
=> [null,null,null]
```

```ts cleanup
delete process.env.GEMINI_KEY;
delete process.env.SKE_GEMINI_API_KEY;
delete process.env.THINKING_OPENAI_API_KEY;
delete process.env.BBX_OPENAI_API_KEY;
await box.cleanup();
await rm(dir, { recursive: true, force: true });
```
