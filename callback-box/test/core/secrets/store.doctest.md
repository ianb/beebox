# The machine-level secret store

`src/core/secrets/store.ts` holds one 0600 JSON file per machine
(`$CB_SECRETS_FILE`, default `~/.config/cb/secrets.json`); the lifecycle
operations in `src/core/secrets/lifecycle.ts` are the only writers. Design:
`docs/plans/secret-custody.md`, Track 2.

Every value below is an obvious placeholder — a real-looking key must never
appear in a fixture.

```ts setup
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSecretStore, secretsFilePath } from "../../../src/core/secrets/store.js";
import {
  boxSecretStatus,
  declareSecret,
  grantSecret,
  listSecrets,
  removeSecret,
  revokeSecret,
  setSecret,
} from "../../../src/core/secrets/lifecycle.js";

/** Point the store at a fresh temp file; returns the directory to clean up. */
async function useTempStore() {
  const dir = await mkdtemp(join(tmpdir(), "cb-secrets-"));
  process.env.CB_SECRETS_FILE = join(dir, "secrets.json");
  return dir;
}
```

## Round trip: set, grant, and the file's mode

Adding a secret and granting it are separate acts — adding makes the name
grantable machine-wide, granting is the per-box opt-in.

```ts
const dir = await useTempStore();
await setSecret({ name: "mistral", value: "placeholder-value-1", note: "transcription" });
await grantSecret({ slug: "demo-box", name: "mistral", access: "server" });
const loaded = await loadSecretStore();
print(`loaded: ${loaded.ok}`);
print(`grant: ${loaded.ok ? loaded.value.grants["demo-box"]["mistral"] : "-"}`);
print(`mode: ${((await stat(secretsFilePath())).mode & 0o777).toString(8)}`);
=>
loaded: true
grant: server
mode: 600
```

`list` returns metadata only — a value never leaves the store through it:

```ts continue
const listing = await listSecrets();
print(`name: ${listing[0].name}`);
print(`hasValue: ${listing[0].hasValue}`);
print(`note: ${listing[0].note}`);
print(`grants: ${JSON.stringify(listing[0].grants)}`);
print(`leaks the value: ${JSON.stringify(listing).includes("placeholder-value-1")}`);
=>
name: mistral
hasValue: true
note: transcription
grants: {"demo-box":"server"}
leaks the value: false
```

A missing store file is an EMPTY store, not an error — the first-run case:

```ts continue
await rm(secretsFilePath());
const empty = await loadSecretStore();
print(`ok: ${empty.ok}`);
print(`secrets: ${empty.ok ? Object.keys(empty.value.secrets).length : "-"}`);
=>
ok: true
secrets: 0
```

```ts cleanup
await rm(dir, { recursive: true, force: true });
```

## A corrupt store fails closed

A hand-edit that leaves invalid JSON — or a file that parses but does not match
the schema — makes the whole machine read as "no grants" rather than degrading
to a partial parse. Mutating operations refuse rather than overwrite it.

```ts
const dir = await useTempStore();
await writeFile(secretsFilePath(), "{ not json");
const broken = await loadSecretStore();
print(`ok: ${broken.ok}`);
print(`detail starts: ${broken.ok ? "-" : broken.error.slice(0, 12)}`);

await writeFile(secretsFilePath(), JSON.stringify({ secrets: { x: { value: 3 } } }));
const invalid = await loadSecretStore();
print(`schema ok: ${invalid.ok}`);
=>
ok: false
detail starts: invalid JSON
schema ok: false
```

```ts continue
await listSecrets();
=> throws SecretStoreAccessError

await setSecret({ name: "mistral", value: "placeholder-value-2" });
=> throws SecretStoreAccessError
```

```ts cleanup
await rm(dir, { recursive: true, force: true });
```

## Declare, grant, revoke, and per-box status

`declare` is the agent's surface: it creates an empty, ungranted slot and can
neither supply a value nor grant it. `status` is scoped to one box.

```ts
const dir = await useTempStore();
print(`created: ${(await declareSecret({ name: "weatherapi", note: "for a trick" })).created}`);
print(`again: ${(await declareSecret({ name: "weatherapi" })).created}`);
await grantSecret({ slug: "demo-box", name: "weatherapi", access: "agent" });
await setSecret({ name: "mistral", value: "placeholder-value-3" });
await grantSecret({ slug: "demo-box", name: "mistral", access: "server" });
const status = await boxSecretStatus("demo-box");
print(JSON.stringify(status));
=>
created: true
again: false
{"slug":"demo-box","granted":[{"name":"mistral","access":"server","hasValue":true},{"name":"weatherapi","access":"agent","hasValue":false}],"emptySlots":["weatherapi"],"danglingGrants":[]}
```

Removing a secret deliberately leaves its grants behind, so the resolver can
report a *stale grant* rather than the misleading "no such secret":

```ts continue
await removeSecret("mistral");
print(JSON.stringify((await boxSecretStatus("demo-box")).danglingGrants));
await revokeSecret({ slug: "demo-box", name: "mistral" });
print(JSON.stringify((await boxSecretStatus("demo-box")).danglingGrants));
=>
["mistral"]
[]
```

Revoking a grant the box does not hold is an error, not a silent no-op:

```ts continue
await revokeSecret({ slug: "demo-box", name: "mistral" });
=> throws SecretGrantNotFoundError
```

```ts cleanup
await rm(dir, { recursive: true, force: true });
```

## Single-box secrets refuse a second grant, with an explanation

A Telegram bot token routes to one webhook URL, so a second grant would not
merely be unwise — it would break the box that already uses it.

```ts
const dir = await useTempStore();
await setSecret({
  name: "telegram-bot/demo-box",
  value: "placeholder-value-4",
  owningBox: "demo-box",
  shareable: false,
});
await grantSecret({ slug: "demo-box", name: "telegram-bot/demo-box", access: "server" });
print(`owner granted: ${(await boxSecretStatus("demo-box")).granted.length}`);
=> owner granted: 1
```

```ts continue
await grantSecret({ slug: "other-box", name: "telegram-bot/demo-box", access: "server" });
=> throws SecretNotShareableError: The secret "telegram-bot/demo-box" is marked single-box (it belongs to "demo-box") and cannot also be granted to "other-box". Some credentials bind to one box structurally — a Telegram bot token routes to a single webhook URL — so sharing one would break the box already using it. Create a separate secret for this box.
```

Granting a name that does not exist is refused too — a grant never conjures an
entry:

```ts continue
await grantSecret({ slug: "demo-box", name: "nonexistent", access: "server" });
=> throws SecretNotFoundError
```

```ts cleanup
await rm(dir, { recursive: true, force: true });
```
