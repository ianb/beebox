# Deepgram credential resolution

`src/core/deepgram-key.ts` resolves the box's Deepgram *management* key — the
long-lived one the server spends to mint browser temp keys — from the machine
store's `deepgram` entry and nowhere else
(`docs/implemented-plans/secret-custody.md`). The transition window's in-tree
`_config/connectors/deepgram.secret.json` file and `BBX_DEEPGRAM_API_KEY` +
`BBX_DEEPGRAM_PROJECT` env pair are gone.

Deepgram needs TWO fields, so the store entry's value is a **JSON string** the
consumer parses — the store keeps values opaque so one entry, one grant, and
one rotation stay true for every provider whatever its shape.

Every value below is an obvious placeholder.

```ts setup
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDeepgramCredentials } from "../../src/core/deepgram-key.js";
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

## A grant is the only thing that resolves

The env pair and the stray file are both set here precisely to show they do
nothing.

```ts
const dir = await useTempStore();
const box = await makeTmpBox();
const slug = await boxSlug(box.root);
process.env.BBX_DEEPGRAM_API_KEY = "placeholder-env-key";
process.env.BBX_DEEPGRAM_PROJECT = "placeholder-env-project";
await box.write(
  "_config/connectors/deepgram.secret.json",
  JSON.stringify({ apiKey: "placeholder-file-key", projectId: "placeholder-file-project" }),
);

print(`env pair and stray file: ${await getDeepgramCredentials(box.root, { observe: true })}`);

await setSecret({
  name: "deepgram",
  value: JSON.stringify({ apiKey: "placeholder-store-key", projectId: "placeholder-store-project" }),
});
await grantSecret({ slug, name: "deepgram", access: "server" });
print(`store granted: ${JSON.stringify(await getDeepgramCredentials(box.root, { observe: true }))}`);
=>
env pair and stray file: null
store granted: {"apiKey":"placeholder-store-key","projectId":"placeholder-store-project"}
```

## A malformed JSON-string value degrades to not-configured

The boxholder put something in the store deliberately, so the mistake is
reported rather than papered over. The warning names the secret; the connector
sees the "not configured" it already handles.

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

No entry at all is `null`, not a throw:

```ts continue
process.env.BBX_SECRETS_FILE = join(dir, "no-store-here.json");
await getDeepgramCredentials(box.root, { observe: true });
=> null
```

```ts cleanup
delete process.env.BBX_DEEPGRAM_API_KEY;
delete process.env.BBX_DEEPGRAM_PROJECT;
await box.cleanup();
await rm(dir, { recursive: true, force: true });
```
