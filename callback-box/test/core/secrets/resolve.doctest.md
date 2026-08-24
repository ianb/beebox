# Resolving a secret: grants, access levels, refusals, and the access log

`src/core/secrets/resolve.ts` is the one way a value leaves the store. Every
outcome is a typed `Result` (callers branch on *why*) and every outcome is
logged — refusals included, because a box repeatedly asking for a secret it was
never granted is exactly what an access log is for. Design:
`docs/plans/secret-custody.md`, Track 2.

Values below are obvious placeholders.

```ts setup
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boxSlug } from "../../../src/lib/box-slug.js";
import { resolveSecret } from "../../../src/core/secrets/resolve.js";
import { grantSecret, setSecret, declareSecret, removeSecret } from "../../../src/core/secrets/lifecycle.js";
import { accessLogSegmentPath } from "../../../src/core/secrets/access-log.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

async function useTempStore() {
  const dir = await mkdtemp(join(tmpdir(), "cb-secrets-"));
  process.env.CB_SECRETS_FILE = join(dir, "secrets.json");
  return dir;
}

/** The refusal kind, or the resolved placeholder value on success. */
async function outcome(opts) {
  const result = await resolveSecret(opts);
  return result.ok ? `ok:${result.value.value}${result.value.suspect ? " (suspect)" : ""}` : result.error.kind;
}
```

## A granted server secret resolves, and the resolve is logged

```ts
const dir = await useTempStore();
const box = await makeTmpBox();
const slug = await boxSlug(box.root);
await setSecret({ name: "mistral", value: "placeholder-value-1" });
await grantSecret({ slug, name: "mistral", access: "server" });
await outcome({ boxRoot: box.root, name: "mistral", purpose: "transcription", access: "server" });
=> ok:placeholder-value-1
```

The log line names the box, the secret, and the purpose — never the value:

```ts continue
const line = JSON.parse((await readFile(accessLogSegmentPath(new Date().toISOString()), "utf-8")).trim());
print(`event: ${line.event}`);
print(`box matches: ${line.box === slug}`);
print(`secret: ${line.secret}`);
print(`purpose: ${line.purpose}`);
print(`leaks the value: ${JSON.stringify(line).includes("placeholder-value-1")}`);
=>
event: resolve
box matches: true
secret: mistral
purpose: transcription
leaks the value: false
```

```ts cleanup
await box.cleanup();
await rm(dir, { recursive: true, force: true });
```

## Access levels: `agent` includes server access, `server` does not include agent

The level lives on the GRANT, not on the secret: the same secret can be
server-only for one box and agent-resolvable for another.

```ts
const dir = await useTempStore();
const box = await makeTmpBox();
const slug = await boxSlug(box.root);
await setSecret({ name: "serveronly", value: "placeholder-value-2" });
await setSecret({ name: "agentok", value: "placeholder-value-3" });
await grantSecret({ slug, name: "serveronly", access: "server" });
await grantSecret({ slug, name: "agentok", access: "agent" });

print(`server grant, server ask: ${await outcome({ boxRoot: box.root, name: "serveronly", purpose: "p", access: "server" })}`);
print(`server grant, agent ask: ${await outcome({ boxRoot: box.root, name: "serveronly", purpose: "p", access: "agent" })}`);
print(`agent grant, server ask: ${await outcome({ boxRoot: box.root, name: "agentok", purpose: "p", access: "server" })}`);
print(`agent grant, agent ask: ${await outcome({ boxRoot: box.root, name: "agentok", purpose: "p", access: "agent" })}`);
=>
server grant, server ask: ok:placeholder-value-2
server grant, agent ask: agent-access-not-granted
agent grant, server ask: ok:placeholder-value-3
agent grant, agent ask: ok:placeholder-value-3
```

The `agent-access-not-granted` message is written for relay — the agent reads it
out and the boxholder knows exactly which action fixes it:

```ts continue
const refused = await resolveSecret({ boxRoot: box.root, name: "serveronly", purpose: "p", access: "agent" });
refused.ok ? "resolved" : refused.error.message;
=> The secret "serveronly" is granted to this box ("«*»") for server use only, and box code asked for the value. Ask the boxholder to raise the grant to agent access.
```

```ts cleanup
await box.cleanup();
await rm(dir, { recursive: true, force: true });
```

## Every other refusal kind

Each condition is distinct because its remediation is: declare it, fill it,
grant it, clean up a stale grant, or call the boxholder.

```ts
const dir = await useTempStore();
const box = await makeTmpBox();
const slug = await boxSlug(box.root);

print(`no entry, no grant: ${await outcome({ boxRoot: box.root, name: "nothing", purpose: "p", access: "server" })}`);

await setSecret({ name: "ungranted", value: "placeholder-value-4" });
print(`entry, no grant: ${await outcome({ boxRoot: box.root, name: "ungranted", purpose: "p", access: "server" })}`);

await declareSecret({ name: "declared", note: "awaiting a value" });
await grantSecret({ slug, name: "declared", access: "server" });
print(`granted, no value: ${await outcome({ boxRoot: box.root, name: "declared", purpose: "p", access: "server" })}`);

await setSecret({ name: "doomed", value: "placeholder-value-5" });
await grantSecret({ slug, name: "doomed", access: "server" });
await removeSecret("doomed");
print(`grant outlived entry: ${await outcome({ boxRoot: box.root, name: "doomed", purpose: "p", access: "server" })}`);

await writeFile(process.env.CB_SECRETS_FILE, "{ not json");
print(`store corrupt: ${await outcome({ boxRoot: box.root, name: "ungranted", purpose: "p", access: "server" })}`);
=>
no entry, no grant: unknown-secret
entry, no grant: not-granted
granted, no value: empty-slot
grant outlived entry: dangling-grant
store corrupt: store-unreadable
```

Refusals are logged too, each carrying its kind:

```ts continue
const kinds = (await readFile(accessLogSegmentPath(new Date().toISOString()), "utf-8"))
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l).refusal)
  .join(",");
kinds;
=> unknown-secret,not-granted,empty-slot,dangling-grant,store-unreadable
```

```ts cleanup
await box.cleanup();
await rm(dir, { recursive: true, force: true });
```

## A failed probe makes a successful resolve `suspect`

The probe machinery itself is a later chunk; the resolver only reads the field
and passes "this key may be expired" along with the value.

```ts
const dir = await useTempStore();
const box = await makeTmpBox();
const slug = await boxSlug(box.root);
await setSecret({ name: "stale", value: "placeholder-value-6" });
await grantSecret({ slug, name: "stale", access: "server" });
const store = JSON.parse(await readFile(process.env.CB_SECRETS_FILE, "utf-8"));
store.secrets.stale.verified = { status: "failed", at: "2026-08-17T00:00:00.000Z", reason: "401" };
await writeFile(process.env.CB_SECRETS_FILE, JSON.stringify(store));
await outcome({ boxRoot: box.root, name: "stale", purpose: "p", access: "server" });
=> ok:placeholder-value-6 (suspect)
```

```ts cleanup
await box.cleanup();
await rm(dir, { recursive: true, force: true });
```

## `lastUsed` is stamped for the box that resolved

Summarized into the entry (hourly at most) so deleting an old log segment never
loses "is this still in use".

```ts
const dir = await useTempStore();
const box = await makeTmpBox();
const slug = await boxSlug(box.root);
await setSecret({ name: "used", value: "placeholder-value-7" });
await grantSecret({ slug, name: "used", access: "server" });
await resolveSecret({ boxRoot: box.root, name: "used", purpose: "p", access: "server" });
const stamped = JSON.parse(await readFile(process.env.CB_SECRETS_FILE, "utf-8"));
print(`stamped: ${typeof stamped.secrets.used.lastUsed[slug] === "string"}`);
print(`boxes: ${Object.keys(stamped.secrets.used.lastUsed).length}`);
=>
stamped: true
boxes: 1
```

```ts cleanup
await box.cleanup();
await rm(dir, { recursive: true, force: true });
```

## A status-only probe is logged, but is not a USE

`observe: false` splits the two records apart. A health check resolving the key
to answer "is this configured?" really did read the value, so the access log
keeps its line — attribution stays complete. What it must not do is move
`lastUsed` and `purposes`, which answer "is this grant still earning its keep":
a dashboard polling health every minute would otherwise pin a dead key's
last-use to now forever.

```ts
const dir = await useTempStore();
const box = await makeTmpBox();
const slug = await boxSlug(box.root);
await setSecret({ name: "probed", value: "placeholder-value-8" });
await grantSecret({ slug, name: "probed", access: "server" });
await resolveSecret({ boxRoot: box.root, name: "probed", purpose: "health-check", access: "server", observe: false });
const probed = JSON.parse(await readFile(process.env.CB_SECRETS_FILE, "utf-8")).secrets.probed;
const logged = JSON.parse((await readFile(accessLogSegmentPath(new Date().toISOString()), "utf-8")).trim());
print(`logged: ${logged.event} ${logged.purpose}`);
print(`lastUsed: ${JSON.stringify(probed.lastUsed)}`);
print(`purposes: ${JSON.stringify(probed.purposes)}`);
=>
logged: resolve health-check
lastUsed: undefined
purposes: undefined
```

A real resolve — `observe` omitted — stamps both, and the probe's label is
nowhere in the observed list:

```ts continue
await resolveSecret({ boxRoot: box.root, name: "probed", purpose: "real-work", access: "server" });
const used = JSON.parse(await readFile(process.env.CB_SECRETS_FILE, "utf-8")).secrets.probed;
print(`stamped: ${typeof used.lastUsed[slug] === "string"}`);
print(`purposes: ${JSON.stringify(used.purposes)}`);
=>
stamped: true
purposes: ["real-work"]
```

```ts cleanup
await box.cleanup();
await rm(dir, { recursive: true, force: true });
```

## `purpose` is a label, not free text

It is written verbatim into the access log the boxholder reads, so the resolver
holds callers to `^[a-z0-9][a-z0-9-]{0,39}$`. In-process callers are our own
code, so a violation is a broken invariant rather than a refusal — the route
that takes one from agent-authored code (`webapp/routes/secrets.ts`) rejects it
with `bad-request` first.

```ts
const dir = await useTempStore();
const box = await makeTmpBox();
await resolveSecret({ boxRoot: box.root, name: "anything", purpose: "Not A Label", access: "server" });
=> throws InvariantError
```

```ts continue
await resolveSecret({ boxRoot: box.root, name: "anything", purpose: "with\nnewline", access: "server" });
=> throws InvariantError

(await resolveSecret({ boxRoot: box.root, name: "anything", purpose: "google-oauth", access: "server" })).error.kind
=> unknown-secret
```

```ts cleanup
await box.cleanup();
await rm(dir, { recursive: true, force: true });
```
