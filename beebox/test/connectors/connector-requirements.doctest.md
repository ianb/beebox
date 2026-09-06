# `<requires><connector>` counts a granted secret, not just a file

A scheduled script can declare `<requires><connector>name</connector></requires>`
and the scheduler skips it cleanly when the connector isn't configured
(`src/connectors/requirements.ts`).

That probe used to check one thing: does `_config/connectors/<name>.secret.json`
exist? Credentials now live in the machine store
(`docs/implemented-plans/secret-custody.md`), so the probe asks about a grant
with a value instead. A leftover file is not an answer either way: nothing reads
those files, so counting one would start a script that then fails for want of a
credential.

Placeholder values throughout.

```ts setup
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkMissingConnectors } from "../../src/connectors/requirements.js";
import { declareSecret, grantSecret, revokeSecret, setSecret } from "../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../src/lib/box-slug.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

async function useTempStore() {
  const dir = await mkdtemp(join(tmpdir(), "bbx-secrets-"));
  process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
  return dir;
}

/** What the scheduler would report as missing. */
async function missing(boxRoot, ...connectors) {
  return JSON.stringify(await checkMissingConnectors(boxRoot, { connectors }));
}
```

## A granted secret with a value configures the connector

```ts
const dir = await useTempStore();
const box = await makeTmpBox();
const slug = await boxSlug(box.root);

print(`nothing configured: ${await missing(box.root, "raindrop")}`);
await setSecret({ name: "raindrop", value: "placeholder-raindrop-key" });
print(`stored but not granted: ${await missing(box.root, "raindrop")}`);
await grantSecret({ slug, name: "raindrop", access: "server" });
print(`granted: ${await missing(box.root, "raindrop")}`);
await revokeSecret({ slug, name: "raindrop" });
print(`revoked again: ${await missing(box.root, "raindrop")}`);
=>
nothing configured: ["raindrop"]
stored but not granted: ["raindrop"]
granted: []
revoked again: ["raindrop"]
```

A granted-but-empty slot is a declared intention, not a configured connector —
the script would fail exactly as it does with no grant at all.

```ts continue
await declareSecret({ name: "someservice", note: "waiting on the boxholder" });
await grantSecret({ slug, name: "someservice", access: "agent" });
print(`granted, no value yet: ${await missing(box.root, "someservice")}`);
=>
granted, no value yet: ["someservice"]
```

## Telegram's store name differs from its connector name

The store says what the credential *is* (`telegram-bot/<box>`, one per box); the
requirement says what *syncs* (`telegram`). The mapping is stated, not derived.

Only the per-box form counts: the connector resolves exactly
`telegram-bot/<slug>`, so a flat `telegram-bot` grant would make a script run
and fail rather than skip cleanly.

```ts continue
await setSecret({ name: "telegram-bot", value: JSON.stringify({ botToken: "111111:placeholder", webhookSecret: "x" }) });
await grantSecret({ slug, name: "telegram-bot", access: "server" });
print(`a flat grant does not count: ${await missing(box.root, "telegram")}`);

await setSecret({ name: `telegram-bot/${slug}`, value: JSON.stringify({ botToken: "111111:placeholder", webhookSecret: "x" }) });
print(`stored per-box, not granted: ${await missing(box.root, "telegram")}`);
await grantSecret({ slug, name: `telegram-bot/${slug}`, access: "server" });
print(`granted per-box: ${await missing(box.root, "telegram")}`);
=>
a flat grant does not count: ["telegram"]
stored per-box, not granted: ["telegram"]
granted per-box: []
```

## A retired in-tree file does not satisfy it

`bbx health` flags such a file separately; here it is simply not a credential.

```ts continue
await box.write("_config/connectors/pocket.secret.json", JSON.stringify({ apiKey: "placeholder-pocket-key" }));
print(`stray file only: ${await missing(box.root, "pocket")}`);
print(`several at once: ${await missing(box.root, "pocket", "raindrop", "nothinghere")}`);
=>
stray file only: ["pocket"]
several at once: ["pocket","raindrop","nothinghere"]
```

```ts cleanup
await box.cleanup();
await rm(dir, { recursive: true, force: true });
```
