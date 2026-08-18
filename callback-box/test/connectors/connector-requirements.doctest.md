# `<requires><connector>` counts a granted secret, not just a file

A scheduled script can declare `<requires><connector>name</connector></requires>`
and the scheduler skips it cleanly when the connector isn't configured
(`src/connectors/requirements.ts`).

That probe used to check one thing: does `config/connectors/<name>.secret.json`
exist? Once credentials moved to the machine store
(`docs/plans/secret-custody.md`, Track 3) a fully migrated box has no such file
— so a file-only probe would report every connector as missing and silently skip
every script that requires one. A grant with a value now counts too, and the
legacy file remains as the transition-window fallback.

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
  const dir = await mkdtemp(join(tmpdir(), "cb-secrets-"));
  process.env.CB_SECRETS_FILE = join(dir, "secrets.json");
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

```ts continue
await setSecret({ name: `telegram-bot/${slug}`, value: JSON.stringify({ botToken: "111111:placeholder", webhookSecret: "x" }) });
print(`before the grant: ${await missing(box.root, "telegram")}`);
await grantSecret({ slug, name: `telegram-bot/${slug}`, access: "server" });
print(`after the grant: ${await missing(box.root, "telegram")}`);
=>
before the grant: ["telegram"]
after the grant: []
```

## The legacy in-tree file still satisfies it

A box that has not migrated keeps working — that is the whole point of the
transition window (`cb health` flags the surviving file separately).

```ts continue
await box.write("config/connectors/pocket.secret.json", JSON.stringify({ apiKey: "placeholder-pocket-key" }));
print(`legacy file only: ${await missing(box.root, "pocket")}`);
print(`several at once: ${await missing(box.root, "pocket", "raindrop", "nothinghere")}`);
=>
legacy file only: []
several at once: ["raindrop","nothinghere"]
```

```ts cleanup
await box.cleanup();
await rm(dir, { recursive: true, force: true });
```
