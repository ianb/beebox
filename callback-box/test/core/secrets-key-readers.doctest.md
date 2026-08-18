# Fallback order for the single-string key readers

Three readers share the `mistral-key.ts` template but differ in which legacy
sources they have, and the differences are load-bearing for the migration
(`docs/plans/secret-custody.md`, Track 3):

| Reader | Store name | Legacy file | Env |
|---|---|---|---|
| `core/gemini-key.ts` | `gemini` | none (never had one) | `GEMINI_KEY`, then `SKE_GEMINI_API_KEY` |
| `core/openai-thinking-key.ts` | `openai-thinking` | none (never had one) | `THINKING_OPENAI_API_KEY` |
| `core/search/embeddings-key.ts` | `openai` | `config/connectors/openai.secret.json` | `CALLBACK_OPENAI_API_KEY` |

`openai` and `openai-thinking` are deliberately two names for two keys: the
store name matches the legacy file basename where one exists, and a
transcription key was never consent to pay for embeddings.

Every value below is an obvious placeholder.

```ts setup
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getGeminiApiKey } from "../../src/core/gemini-key.js";
import { getOpenAiThinkingKey } from "../../src/core/openai-thinking-key.js";
import { getOpenAiEmbeddingsKey, resetEmbeddingsLegacyWarning } from "../../src/core/search/embeddings-key.js";
import { grantSecret, setSecret } from "../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../src/lib/box-slug.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

async function useTempStore() {
  const dir = await mkdtemp(join(tmpdir(), "cb-secrets-"));
  process.env.CB_SECRETS_FILE = join(dir, "secrets.json");
  return dir;
}

/** Run `fn` with console.warn captured; returns [result, warnings]. */
async function withWarnings(fn) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  try {
    return [await fn(), warnings];
  } finally {
    console.warn = original;
  }
}
```

## Gemini: store beats `GEMINI_KEY` beats `SKE_GEMINI_API_KEY`

```ts
const dir = await useTempStore();
const box = await makeTmpBox();
const slug = await boxSlug(box.root);

// A developer machine may genuinely have these exported; start from nothing so
// the ordering below is the code's, not the shell's.
delete process.env.GEMINI_KEY;
delete process.env.THINKING_OPENAI_API_KEY;
delete process.env.CALLBACK_OPENAI_API_KEY;

process.env.SKE_GEMINI_API_KEY = "placeholder-legacy-env-key";
print(`legacy env only: ${await getGeminiApiKey(box.root)}`);

process.env.GEMINI_KEY = "placeholder-env-key";
print(`both env vars: ${await getGeminiApiKey(box.root)}`);

await setSecret({ name: "gemini", value: "placeholder-store-key" });
print(`stored but ungranted: ${await getGeminiApiKey(box.root)}`);

await grantSecret({ slug, name: "gemini", access: "server" });
print(`store granted: ${await getGeminiApiKey(box.root)}`);
=>
legacy env only: placeholder-legacy-env-key
both env vars: placeholder-env-key
stored but ungranted: placeholder-env-key
store granted: placeholder-store-key
```

A grant is the per-box opt-in, so a secret merely *present* on the machine
changes nothing for a box — the "stored but ungranted" line above is the
fail-closed property, not an accident of ordering.

## The thinking key is its own name

Granting `openai` does not configure `openai-thinking`, and vice versa.

```ts continue
process.env.THINKING_OPENAI_API_KEY = "placeholder-thinking-env-key";
await setSecret({ name: "openai", value: "placeholder-embeddings-store-key" });
await grantSecret({ slug, name: "openai", access: "server" });
print(`thinking key with only "openai" granted: ${await getOpenAiThinkingKey(box.root)}`);

await setSecret({ name: "openai-thinking", value: "placeholder-thinking-store-key" });
await grantSecret({ slug, name: "openai-thinking", access: "server" });
print(`thinking key granted: ${await getOpenAiThinkingKey(box.root)}`);
print(`embeddings key still: ${await getOpenAiEmbeddingsKey(box.root)}`);
=>
thinking key with only "openai" granted: placeholder-thinking-env-key
thinking key granted: placeholder-thinking-store-key
embeddings key still: placeholder-embeddings-store-key
```

## Embeddings: the store wins over a stray file, and the file warns

```ts continue
process.env.CB_SECRETS_FILE = join(dir, "no-store-here.json");
await box.write("config/connectors/openai.secret.json", JSON.stringify({ apiKey: "placeholder-file-key" }));
resetEmbeddingsLegacyWarning();
const [fromFile, warnings] = await withWarnings(() => getOpenAiEmbeddingsKey(box.root));
print(`file present: ${fromFile}`);
print(`warned once: ${warnings.some((w) => w.includes("config/connectors/openai.secret.json"))}`);

const [, second] = await withWarnings(() => getOpenAiEmbeddingsKey(box.root));
print(`second call warned: ${second.length > 0}`);

process.env.CB_SECRETS_FILE = join(dir, "secrets.json");
print(`store present: ${await getOpenAiEmbeddingsKey(box.root)}`);
=>
file present: placeholder-file-key
warned once: true
second call warned: false
store present: placeholder-embeddings-store-key
```

Nothing configured anywhere is `null` for all three — the callers' existing
"not configured" path, never a throw:

```ts continue
process.env.CB_SECRETS_FILE = join(dir, "no-store-here.json");
await rm(join(box.root, "config/connectors/openai.secret.json"));
delete process.env.GEMINI_KEY;
delete process.env.SKE_GEMINI_API_KEY;
delete process.env.THINKING_OPENAI_API_KEY;
JSON.stringify([
  await getGeminiApiKey(box.root),
  await getOpenAiThinkingKey(box.root),
  await getOpenAiEmbeddingsKey(box.root),
])
=> [null,null,null]
```

```ts cleanup
delete process.env.GEMINI_KEY;
delete process.env.SKE_GEMINI_API_KEY;
delete process.env.THINKING_OPENAI_API_KEY;
await box.cleanup();
await rm(dir, { recursive: true, force: true });
```
