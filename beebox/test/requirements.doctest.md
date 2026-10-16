# `<requires><connector>` counts a granted secret, not just a file

A scheduled script can declare `<requires><connector>name</connector></requires>`
and the scheduler skips it cleanly when the connector isn't configured
(`src/requirements.ts`).

That probe used to check one thing: does `_config/connectors/<name>.secret.json`
exist? Credentials now live in the machine store
(`docs/implemented-plans/secret-custody.md`), so the probe asks about a grant
with a value instead. A leftover file is not an answer either way: nothing reads
those files, so counting one would start a script that then fails for want of a
credential.

Placeholder values throughout.

```ts setup
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkMissingConnectors } from "../src/requirements.js";
import { declareSecret, grantSecret, revokeSecret, setSecret } from "../src/core/secrets/lifecycle.js";
import { boxSlug } from "../src/lib/box-slug.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";

async function useTempStore() {
  const dir = await mkdtemp(join(tmpdir(), "bbx-secrets-"));
  process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
  return dir;
}

/** What the scheduler would report as missing. */
async function missing(boxRoot: string, ...connectors: string[]) {
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

## A per-box instance of a name counts

A requirement names the store entry itself or its per-box form
`<name>/<slug>`; either one, granted to this box and holding a value, is
configured.

```ts continue
await setSecret({ name: `otherservice/${slug}`, value: "placeholder-token" });
print(`stored per-box, not granted: ${await missing(box.root, "otherservice")}`);
await grantSecret({ slug, name: `otherservice/${slug}`, access: "server" });
print(`granted per-box: ${await missing(box.root, "otherservice")}`);
=>
stored per-box, not granted: ["otherservice"]
granted per-box: []
```

## Google needs the client-credential grant too, not just tokens

Tokens plus an enabled policy used to be enough. They are not: without a grant
for the OAuth app's client credentials, `getGoogleAuth` returns null, so every
Google connector reports `skipped: not-configured` and syncs nothing. A script
that runs and does nothing is worse than one the scheduler skips before it
spends a run.

```ts continue
const tokensFile = join(dir, "google-tokens.json");
await writeFile(tokensFile, JSON.stringify({ refreshToken: "placeholder-refresh" }));
process.env.BBX_GOOGLE_TOKENS_FILE = tokensFile;
await box.write("_config/box.json", JSON.stringify({ googleServices: { gmail: true } }));

print(`tokens + policy, no client grant: ${await missing(box.root, "gmail")}`);

for (const name of ["google-oauth-client-id", "google-oauth-client-secret"]) {
  await setSecret({ name, value: `placeholder-${name}` });
  await grantSecret({ slug, name, access: "server" });
}
print(`client credentials granted: ${await missing(box.root, "gmail")}`);

// The per-box policy still gates it independently.
await box.write("_config/box.json", JSON.stringify({ googleServices: { gmail: false } }));
print(`policy disabled: ${await missing(box.root, "gmail")}`);
=>
tokens + policy, no client grant: ["gmail"]
client credentials granted: []
policy disabled: ["gmail"]
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
delete process.env.BBX_GOOGLE_TOKENS_FILE;
await box.cleanup();
await rm(dir, { recursive: true, force: true });
```
