# Mistral key resolution order

`src/core/mistral-key.ts` is the first consumer migrated onto the machine-level
secret store, and the template for the rest (`docs/plans/secret-custody.md`,
Track 3). Order: the store wins, then the deprecated in-tree
`config/connectors/mistral.secret.json` (warned about once per process, naming
the stray file), then `CALLBACK_MISTRAL_API_KEY`. A box with none of them still
degrades to `null` — the caller's existing "not configured" path.

Every key below is an obvious placeholder.

```ts setup
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getMistralApiKey, resetMistralLegacyWarning } from "../../src/core/mistral-key.js";
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

## Store beats file beats env

```ts
const dir = await useTempStore();
const box = await makeTmpBox();
const slug = await boxSlug(box.root);
process.env.CALLBACK_MISTRAL_API_KEY = "placeholder-env-key";

print(`env only: ${await getMistralApiKey(box.root)}`);

await box.write("config/connectors/mistral.secret.json", JSON.stringify({ apiKey: "placeholder-file-key" }));
resetMistralLegacyWarning();
const [fromFile, warnings] = await withWarnings(() => getMistralApiKey(box.root));
print(`file present: ${fromFile}`);
print(`warned about the stray file: ${warnings.some((w) => w.includes("config/connectors/mistral.secret.json"))}`);

await setSecret({ name: "mistral", value: "placeholder-store-key" });
await grantSecret({ slug, name: "mistral", access: "server" });
print(`store granted: ${await getMistralApiKey(box.root)}`);
=>
env only: placeholder-env-key
file present: placeholder-file-key
warned about the stray file: true
store granted: placeholder-store-key
```

The deprecation warning is once per process, not once per transcription:

```ts continue
process.env.CB_SECRETS_FILE = join(dir, "no-store-here.json");
resetMistralLegacyWarning();
const [, first] = await withWarnings(() => getMistralApiKey(box.root));
const [, second] = await withWarnings(() => getMistralApiKey(box.root));
print(`first call warned: ${first.length > 0}`);
print(`second call warned: ${second.length > 0}`);
=>
first call warned: true
second call warned: false
```

Nothing configured at all is `null`, not a throw:

```ts continue
delete process.env.CALLBACK_MISTRAL_API_KEY;
await rm(join(box.root, "config/connectors/mistral.secret.json"));
await getMistralApiKey(box.root);
=> null
```

A caller with no box root at all (the env-only path) still works:

```ts continue
process.env.CALLBACK_MISTRAL_API_KEY = "placeholder-env-key";
await getMistralApiKey();
=> placeholder-env-key
```

```ts cleanup
delete process.env.CALLBACK_MISTRAL_API_KEY;
await box.cleanup();
await rm(dir, { recursive: true, force: true });
```
