# Deepgram credential resolution order

`src/core/deepgram-key.ts` resolves the box's Deepgram *management* key — the
long-lived one the server spends to mint browser temp keys. Order
(`docs/plans/secret-custody.md`, Track 3): the machine store's `deepgram`
entry, then the deprecated in-tree `_config/connectors/deepgram.secret.json`,
then `BBX_DEEPGRAM_API_KEY` + `BBX_DEEPGRAM_PROJECT`.

Deepgram needs TWO fields, so the store entry's value is a **JSON string** the
consumer parses — the store keeps values opaque so one entry, one grant, and
one rotation stay true for every provider whatever its shape.

Every value below is an obvious placeholder.

```ts setup
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDeepgramCredentials, resetDeepgramLegacyWarning } from "../../src/core/deepgram-key.js";
import { grantSecret, setSecret } from "../../src/core/secrets/lifecycle.js";
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

## Store beats file beats env

```ts
const dir = await useTempStore();
const box = await makeTmpBox();
const slug = await boxSlug(box.root);
process.env.BBX_DEEPGRAM_API_KEY = "placeholder-env-key";
process.env.BBX_DEEPGRAM_PROJECT = "placeholder-env-project";

print(`env only: ${JSON.stringify(await getDeepgramCredentials(box.root, { observe: true }))}`);

await box.write(
  "_config/connectors/deepgram.secret.json",
  JSON.stringify({ apiKey: "placeholder-file-key", projectId: "placeholder-file-project" }),
);
resetDeepgramLegacyWarning();
const [fromFile, warnings] = await withWarnings(() => getDeepgramCredentials(box.root, { observe: true }));
print(`file present: ${JSON.stringify(fromFile)}`);
print(`warned about the stray file: ${warnings.some((w) => w.includes("_config/connectors/deepgram.secret.json"))}`);

await setSecret({
  name: "deepgram",
  value: JSON.stringify({ apiKey: "placeholder-store-key", projectId: "placeholder-store-project" }),
});
await grantSecret({ slug, name: "deepgram", access: "server" });
print(`store granted: ${JSON.stringify(await getDeepgramCredentials(box.root, { observe: true }))}`);
=>
env only: {"apiKey":"placeholder-env-key","projectId":"placeholder-env-project"}
file present: {"apiKey":"placeholder-file-key","projectId":"placeholder-file-project"}
warned about the stray file: true
store granted: {"apiKey":"placeholder-store-key","projectId":"placeholder-store-project"}
```

## A malformed JSON-string value degrades to not-configured

It does NOT silently fall through to the stale file: the boxholder put
something in the store deliberately, so shadowing it would hide the mistake
behind a credential they thought they had replaced. The warning names the
secret; the connector sees the "not configured" it already handles.

```ts continue
await setSecret({ name: "deepgram", value: "not-json-at-all" });
const [bad, badWarnings] = await withWarnings(() => getDeepgramCredentials(box.root, { observe: true }));
print(`not JSON: ${bad}`);
print(`warned: ${badWarnings.some((w) => w.includes('"deepgram" is not valid JSON'))}`);

await setSecret({ name: "deepgram", value: JSON.stringify({ apiKey: 42 }) });
const [wrongShape, shapeWarnings] = await withWarnings(() => getDeepgramCredentials(box.root, { observe: true }));
print(`wrong shape: ${wrongShape}`);
print(`warned: ${shapeWarnings.some((w) => w.includes("does not match the shape"))}`);
=>
not JSON: null
warned: true
wrong shape: null
warned: true
```

## A half-configured credential is no credential

Both fields are required — one without the other cannot call Deepgram at all,
so it reads as not configured rather than half-working.

```ts continue
await setSecret({ name: "deepgram", value: JSON.stringify({ apiKey: "placeholder-store-key" }) });
await getDeepgramCredentials(box.root, { observe: true });
=> null
```

Nothing configured anywhere is `null`, not a throw:

```ts continue
delete process.env.BBX_DEEPGRAM_API_KEY;
delete process.env.BBX_DEEPGRAM_PROJECT;
process.env.BBX_SECRETS_FILE = join(dir, "no-store-here.json");
await rm(join(box.root, "_config/connectors/deepgram.secret.json"));
await getDeepgramCredentials(box.root, { observe: true });
=> null
```

```ts cleanup
delete process.env.BBX_DEEPGRAM_API_KEY;
delete process.env.BBX_DEEPGRAM_PROJECT;
await box.cleanup();
await rm(dir, { recursive: true, force: true });
```
