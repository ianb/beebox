# Fallback order for the single-string key readers

Three readers share the `mistral-key.ts` template but differ in which legacy
sources they have, and the differences are load-bearing for the migration
(`docs/plans/secret-custody.md`, Track 3):

| Reader | Store name | Legacy file | Env |
|---|---|---|---|
| `core/gemini-key.ts` | `gemini` | none (never had one) | `GEMINI_KEY`, then `SKE_GEMINI_API_KEY` |
| `core/openai-thinking-key.ts` | `openai-thinking` | none (never had one) | `THINKING_OPENAI_API_KEY` |
| `core/search/embeddings-key.ts` | `openai` | `_config/connectors/openai.secret.json` | `BBX_OPENAI_API_KEY` |

`openai` and `openai-thinking` are deliberately two names for two keys: the
store name matches the legacy file basename where one exists, and a
transcription key was never consent to pay for embeddings.

Every value below is an obvious placeholder.

```ts setup
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getGeminiApiKey } from "../../src/core/gemini-key.js";
import { getOpenAiThinkingKey } from "../../src/core/openai-thinking-key.js";
import { getOpenAiEmbeddingsKey, resetEmbeddingsLegacyWarning } from "../../src/core/search/embeddings-key.js";
import { grantSecret, revokeSecret, setSecret } from "../../src/core/secrets/lifecycle.js";
import { resetLegacyFallbackWarnings } from "../../src/core/secrets/legacy-fallback.js";
import { boxSlug } from "../../src/lib/box-slug.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

async function useTempStore() {
  const dir = await mkdtemp(join(tmpdir(), "bbx-secrets-"));
  process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
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
delete process.env.BBX_OPENAI_API_KEY;

process.env.SKE_GEMINI_API_KEY = "placeholder-legacy-env-key";
print(`legacy env only: ${await getGeminiApiKey(box.root, { purpose: "gemini-vision", observe: true })}`);

process.env.GEMINI_KEY = "placeholder-env-key";
print(`both env vars: ${await getGeminiApiKey(box.root, { purpose: "gemini-vision", observe: true })}`);

await setSecret({ name: "gemini", value: "placeholder-store-key" });
const [ungranted, refusalWarnings] = await withWarnings(() => getGeminiApiKey(box.root, { purpose: "gemini-vision", observe: true }));
print(`stored but ungranted: ${ungranted}`);
print(`named the refusal: ${refusalWarnings.join("\n").includes("not-granted")}`);

await grantSecret({ slug, name: "gemini", access: "server" });
print(`store granted: ${await getGeminiApiKey(box.root, { purpose: "gemini-vision", observe: true })}`);
=>
legacy env only: placeholder-legacy-env-key
both env vars: placeholder-env-key
stored but ungranted: null
named the refusal: true
store granted: placeholder-store-key
```

A grant is the per-box opt-in, so a secret merely *present* on the machine
changes nothing for a box. Note *which* nothing: an ungranted box reads as **not
configured**, not as "fall back to the env var it used to use". Only
`unknown-secret` — no entry of that name anywhere on the machine — reaches the
legacy sources (`src/core/secrets/legacy-fallback.ts`). If `not-granted` fell
through, `bbx secrets revoke` would be a no-op on every box that still has a
stale file or an exported variable.

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
thinking key with only "openai" granted: placeholder-thinking-env-key
thinking key granted: placeholder-thinking-store-key
embeddings key still: placeholder-embeddings-store-key
```

## Embeddings: the store wins over a stray file, and the file warns

```ts continue
process.env.BBX_SECRETS_FILE = join(dir, "no-store-here.json");
await box.write("_config/connectors/openai.secret.json", JSON.stringify({ apiKey: "placeholder-file-key" }));
resetEmbeddingsLegacyWarning();
const [fromFile, warnings] = await withWarnings(() => getOpenAiEmbeddingsKey(box.root));
print(`file present: ${fromFile}`);
print(`warned once: ${warnings.some((w) => w.includes("_config/connectors/openai.secret.json"))}`);

const [, second] = await withWarnings(() => getOpenAiEmbeddingsKey(box.root));
print(`second call warned: ${second.length > 0}`);

process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
print(`store present: ${await getOpenAiEmbeddingsKey(box.root)}`);
=>
file present: placeholder-file-key
warned once: true
second call warned: false
store present: placeholder-embeddings-store-key
```

## A refusal is not a fall-through

The legacy file and env var exist for ONE case: the machine has no entry of that
name yet (`unknown-secret`). Every other refusal is not configured, with a
warning that names the kind — otherwise revoking a grant would leave the box
running on whatever stale copy is still lying around.

```ts continue
// The store still holds "openai", granted to this box, and the stray
// openai.secret.json from the section above is still on disk.
process.env.BBX_OPENAI_API_KEY = "placeholder-fallback-env-key";
await revokeSecret({ slug, name: "openai" });
resetLegacyFallbackWarnings();
const [afterRevoke, revokeWarnings] = await withWarnings(() => getOpenAiEmbeddingsKey(box.root));
print(`revoked, file and env still present: ${afterRevoke}`);
print(`names the kind: ${revokeWarnings.join("\n").includes("not-granted")}`);

// A store that cannot be read at all is a machine fault, not a licence to read
// the credentials it was meant to supersede.
const corruptStore = join(dir, "corrupt-store.json");
await writeFile(corruptStore, "{ this is not json");
process.env.BBX_SECRETS_FILE = corruptStore;
const [afterCorrupt, corruptWarnings] = await withWarnings(() => getOpenAiEmbeddingsKey(box.root));
print(`corrupt store, file and env still present: ${afterCorrupt}`);
print(`names the kind: ${corruptWarnings.join("\n").includes("store-unreadable")}`);

// And the case the fallback is FOR: no store, so no entry of that name.
process.env.BBX_SECRETS_FILE = join(dir, "no-store-here.json");
print(`no entry anywhere: ${await getOpenAiEmbeddingsKey(box.root)}`);
=>
revoked, file and env still present: null
names the kind: true
corrupt store, file and env still present: null
names the kind: true
no entry anywhere: placeholder-file-key
```

Nothing configured anywhere is `null` for all three — the callers' existing
"not configured" path, never a throw:

```ts continue
process.env.BBX_SECRETS_FILE = join(dir, "no-store-here.json");
await rm(join(box.root, "_config/connectors/openai.secret.json"));
delete process.env.GEMINI_KEY;
delete process.env.SKE_GEMINI_API_KEY;
delete process.env.THINKING_OPENAI_API_KEY;
delete process.env.BBX_OPENAI_API_KEY;
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
