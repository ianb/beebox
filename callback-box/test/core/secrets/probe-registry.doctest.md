# Verifying a stored secret: the server-owned probe registry

`src/core/secrets/probe-registry.ts` answers "does this credential actually
work?" by making one cheap, harmless, authenticated call and recording the
verdict on the entry (`docs/plans/secret-custody.md`, "Guided entry +
validation").

Two properties matter more than the happy path:

- **Only the server names probe targets.** An agent-supplied probe URL would
  send the freshly-saved secret wherever the agent pointed it. Names with no
  registry entry stay `unchecked` forever — never "probe whatever you like".
- **A bad day is not a bad key.** Only a provider's *auth rejection* records
  `failed` (which is what later makes a resolve `suspect`); a 500, a timeout, or
  DNS failure records `unchecked` with a reason.

Every value below is an obvious placeholder, and `fetch` is injected — no test
here reaches a real provider.

```ts setup
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boxSlug } from "../../../src/lib/box-slug.js";
import {
  declareSecret,
  grantSecret,
  listSecrets,
  setAndGrantSecret,
  setSecret,
} from "../../../src/core/secrets/lifecycle.js";
import {
  describeSecretProbe,
  isAuthRejection,
  markSecretVerificationFailed,
  probeSecret,
} from "../../../src/core/secrets/probe-registry.js";
import { resolveSecret } from "../../../src/core/secrets/resolve.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

async function useTempStore() {
  const dir = await mkdtemp(join(tmpdir(), "cb-secrets-"));
  process.env.CB_SECRETS_FILE = join(dir, "secrets.json");
  return dir;
}

/** A `fetch` that records what it was asked for and answers with one status. */
function recordingFetch(status, calls) {
  return async (url, init) => {
    calls.push({ url, headers: init?.headers ?? {} });
    return new Response("{}", { status });
  };
}

/** The stored verdict for a name — what a later resolve and the admin UI read. */
async function storedVerified(name) {
  const listing = (await listSecrets()).find((entry) => entry.name === name);
  return listing?.verified;
}
```

## A working key: `ok`, recorded on the entry

The Mistral probe lists models — a read-only call that creates nothing and
charges nothing. The key travels in the `Authorization` header, never in the URL.

```ts
const dir = await useTempStore();
const calls = [];
await setSecret({ name: "mistral", value: "placeholder-mistral-key" });
const verified = await probeSecret({ name: "mistral", deps: { fetch: recordingFetch(200, calls) } });

print(`verdict: ${verified.status}`);
print(`called: ${calls[0]?.url}`);
print(`key travelled in the header: ${calls[0]?.headers.Authorization === "Bearer placeholder-mistral-key"}`);
print(`recorded on the entry: ${(await storedVerified("mistral"))?.status}`);
=>
verdict: ok
called: https://api.mistral.ai/v1/models
key travelled in the header: true
recorded on the entry: ok
```

## A rejected key: `failed`, and the reason never quotes the value

```ts continue
const rejected = await probeSecret({ name: "mistral", deps: { fetch: recordingFetch(401, []) } });
print(`verdict: ${rejected.status}`);
print(`reason: ${rejected.reason}`);
print(`reason leaks the value: ${JSON.stringify(rejected).includes("placeholder-mistral-key")}`);
=>
verdict: failed
reason: the provider rejected this credential (HTTP 401)
reason leaks the value: false
```

## A provider outage is inconclusive, not a bad key

A 500 must never flag a working credential as expired — the boxholder would
rotate a perfectly good key.

```ts continue
const blip = await probeSecret({ name: "mistral", deps: { fetch: recordingFetch(500, []) } });
print(`verdict: ${blip.status}`);
print(`reason: ${blip.reason}`);
print(`401 counts as auth, 500 and 429 do not: ${[isAuthRejection(401), isAuthRejection(500), isAuthRejection(429)].join(" ")}`);
=>
verdict: unchecked
reason: the check was inconclusive (HTTP 500)
401 counts as auth, 500 and 429 do not: true false false
```

## A name with no registry entry stays unchecked, and nothing is written

An ad-hoc slot an agent declared has no server-owned probe, and never gains one.

```ts continue
await setSecret({ name: "weatherapi", value: "placeholder-weather-key" });
const adhoc = await probeSecret({ name: "weatherapi", deps: { fetch: recordingFetch(200, []) } });
print(`verdict: ${adhoc.status}`);
print(`reason: ${adhoc.reason}`);
print(`entry left unverified: ${(await storedVerified("weatherapi")) === undefined}`);
print(`no probe described: ${describeSecretProbe({ name: "weatherapi" })}`);
print(`mistral has one: ${describeSecretProbe({ name: "mistral" })}`);
=>
verdict: unchecked
reason: no verification is available for this credential
entry left unverified: true
no probe described: null
mistral has one: lists Mistral models
```

## Per-box families match by prefix — but only for connector-created entries

`telegram-bot/<box>` is one entry per box, so the registry matches the family
rather than every slug. The connector flow that creates one marks it
`owningBox` + `shareable: false`, and **the family probe requires those marks**:
an agent can declare a slot with any name it likes, so matching on the name
alone would let it pick which provider a value the boxholder pasted gets sent to.

```ts continue
const tgCalls = [];
await setAndGrantSecret({
  name: "telegram-bot/somebox",
  value: JSON.stringify({ botToken: "111111:placeholder", webhookSecret: "x" }),
  slug: "somebox",
  access: "server",
  owningBox: "somebox",
  shareable: false,
});
const tg = await probeSecret({ name: "telegram-bot/somebox", deps: { fetch: recordingFetch(200, tgCalls) } });
print(`verdict: ${tg.status}`);
print(`called: ${tgCalls[0]?.url}`);
=>
verdict: ok
called: https://api.telegram.org/bot111111:placeholder/getMe
```

A look-alike name an agent declared gets no probe at all — nothing leaves the
machine.

```ts continue
const impostorCalls = [];
await declareSecret({ name: "telegram-bot/impostor", note: "an agent asked for this", declaredBy: "somebox" });
await setSecret({ name: "telegram-bot/impostor", value: JSON.stringify({ botToken: "222222:placeholder", webhookSecret: "x" }) });
const impostor = await probeSecret({ name: "telegram-bot/impostor", deps: { fetch: recordingFetch(200, impostorCalls) } });
print(`verdict: ${impostor.status} — ${impostor.reason}`);
print(`requests made: ${impostorCalls.length}`);
print(`nothing described either: ${describeSecretProbe({ name: "telegram-bot/impostor" })}`);
=>
verdict: unchecked — no verification is available for this credential
requests made: 0
nothing described either: null
```

A value that is not the shape the credential needs is a `failed` verification —
the probe cannot be run, and the boxholder needs to know that, not a silent
`unchecked`.

```ts continue
await setSecret({ name: "telegram-bot/somebox", value: "not-json-at-all" });
const malformed = await probeSecret({ name: "telegram-bot/somebox", deps: { fetch: recordingFetch(200, []) } });
print(`verdict: ${malformed.status} — ${malformed.reason}`);
=>
verdict: failed — the stored value is not in the shape this credential needs
```

## A probe that outlives its value never stamps the new one

A slow probe against the old key must not land on the rotated one: it would
either hide a bad rotation behind `ok` or mark a fresh key as expired. The write
is a compare-and-set on the entry's `updated` stamp.

```ts continue
let release;
const slowFetch = async () => {
  await new Promise((resolve) => { release = resolve; });
  return new Response("{}", { status: 401 });
};
const slow = probeSecret({ name: "mistral", deps: { fetch: slowFetch } });
await setSecret({ name: "mistral", value: "placeholder-mistral-key-2" });
release();
print(`the stale probe still reports: ${(await slow).status}`);
print(`but the rotated entry is untouched: ${(await storedVerified("mistral")) === undefined}`);
=>
the stale probe still reports: failed
but the rotated entry is untouched: true
```

## Suspect round-trip: a real 401 makes every later resolve say so

`markSecretVerificationFailed` is what a consumer calls when a real call is
rejected for auth — better evidence than any probe, since it is the call the box
actually needed. `resolveSecret` surfaces it as `suspect`, which the admin page
renders as "may be expired".

```ts continue
const box = await makeTmpBox();
const slug = await boxSlug(box.root);
await grantSecret({ slug, name: "weatherapi", access: "agent" });

const before = await resolveSecret({ boxRoot: box.root, name: "weatherapi", purpose: "forecast", access: "agent" });
print(`before: suspect=${before.value.suspect}`);

await markSecretVerificationFailed("weatherapi", "a forecast request was rejected with HTTP 401");
const after = await resolveSecret({ boxRoot: box.root, name: "weatherapi", purpose: "forecast", access: "agent" });
print(`after: suspect=${after.value.suspect}`);
print(`the value still resolves: ${after.value.value === "placeholder-weather-key"}`);
print(`reason on the entry: ${(await storedVerified("weatherapi"))?.reason}`);
=>
before: suspect=false
after: suspect=true
the value still resolves: true
reason on the entry: a forecast request was rejected with HTTP 401
```

Storing a new value clears the old verdict — a rotated key has not been checked
yet, and carrying `failed` forward would leave a fresh key marked expired.

```ts continue
await setSecret({ name: "weatherapi", value: "placeholder-weather-key-2" });
print(`after rotation: ${(await storedVerified("weatherapi")) === undefined}`);
=>
after rotation: true
```

```ts cleanup
await box.cleanup();
await rm(dir, { recursive: true, force: true });
```
