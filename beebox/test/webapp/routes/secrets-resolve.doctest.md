# `POST /api/secrets/resolve` — the loopback resolver for box code

The one interface that discloses a stored value to code running outside a server
process: an agent-authored trick asks its OWN box, with the box's
`BBX_AGENT_TOKEN`, and gets back a value it holds in memory for the length of one
outbound call (`docs/secrets.md`, `docs/plans/secret-custody.md` Track 2).

It is a raw route rather than a tRPC procedure because it must require the
**agent auth source specifically** — the tRPC context folds cookie, hub header,
mobile token, browse key and agent bearer into one `authed` flag, and only the
last of those is box code.

Values below are obvious placeholders.

```ts setup
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTestServer, TEST_SLUG } from "../../helpers/doctest-server.js";
import { getOrCreateAgentToken } from "../../../src/core/agent/token.js";
import { grantSecret, setSecret } from "../../../src/core/secrets/lifecycle.js";
import { secretsLogDir } from "../../../src/core/secrets/store.js";

const storeDir = await mkdtemp(join(tmpdir(), "bbx-secrets-route-"));
const priorStoreFile = process.env.BBX_SECRETS_FILE;
process.env.BBX_SECRETS_FILE = join(storeDir, "secrets.json");

/** Every access-log line written so far, oldest segment first. */
async function accessLog() {
  const dir = secretsLogDir();
  const segments = (await readdir(dir)).toSorted();
  const texts = await Promise.all(segments.map((s) => readFile(join(dir, s), "utf-8")));
  return texts.join("").split("\n").filter((line) => line !== "").map((line) => JSON.parse(line));
}

/** One "label: status kind" line for a resolve attempt with the given headers. */
async function attempt(ctx, label, headers) {
  const denied = await ctx.request({
    method: "POST",
    url: "/api/secrets/resolve",
    payload: { name: "weatherapi", purpose: "weather-trick" },
    headers,
  });
  return `${label}: ${denied.statusCode} ${denied.body.kind}`;
}
```

## An `agent`-level grant resolves, with the token as a bearer

```ts
const ctx = await makeTestServer();
const token = getOrCreateAgentToken(ctx.boxRoot);
const agentAuth = { authorization: `Bearer ${token}` };

await setSecret({ name: "weatherapi", value: "placeholder-weather-key" });
await grantSecret({ slug: TEST_SLUG, name: "weatherapi", access: "agent" });

const res = await ctx.request({
  method: "POST",
  url: "/api/secrets/resolve",
  payload: { name: "weatherapi", purpose: "weather-trick" },
  headers: agentAuth,
});
print(`status: ${res.statusCode}`);
print(JSON.stringify(res.body));
=>
status: 200
{"value":"placeholder-weather-key","suspect":false}
```

## A `server`-level grant refuses with the exact kind the agent can act on

The message is written for relay: the agent reads it out to the boxholder, who
knows which button raises the grant.

```ts continue
await setSecret({ name: "mistral", value: "placeholder-mistral-key" });
await grantSecret({ slug: TEST_SLUG, name: "mistral", access: "server" });

const serverOnly = await ctx.request({
  method: "POST",
  url: "/api/secrets/resolve",
  payload: { name: "mistral", purpose: "weather-trick" },
  headers: agentAuth,
});
print(`status: ${serverOnly.statusCode}`);
print(`kind: ${serverOnly.body.kind}`);
print(`leaks the value: ${JSON.stringify(serverOnly.body).includes("placeholder-mistral-key")}`);
print(serverOnly.body.message);
=>
status: 403
kind: agent-access-not-granted
leaks the value: false
The secret "mistral" is granted to this box ("test") for server use only, and box code asked for the value. Ask the boxholder to raise the grant to agent access.
```

## An unknown name is a 404 that names the fix

```ts continue
const unknown = await ctx.request({
  method: "POST",
  url: "/api/secrets/resolve",
  payload: { name: "no-such-service", purpose: "weather-trick" },
  headers: agentAuth,
});
print(`status: ${unknown.statusCode}`);
print(`kind: ${unknown.body.kind}`);
print(unknown.body.message);
=>
status: 404
kind: unknown-secret
No secret named "no-such-service" exists on this machine. It can be declared (bbx secrets declare no-such-service), but only the boxholder can supply its value.
```

## Nothing but the agent bearer opens it

This test server runs in open access — no auth wall at all — and the route still
refuses every credential that is not the box's own agent token. A wrong bearer,
a session cookie, and the hub's authenticated-email header all get the same 401.

```ts continue
print(await attempt(ctx, "no credential", {}));
print(await attempt(ctx, "wrong bearer", { authorization: "Bearer not-the-agent-token-0000000000000000" }));
print(await attempt(ctx, "session cookie", { cookie: "bbx_session=placeholder-session" }));
print(await attempt(ctx, "hub identity header", { "x-bbx-authenticated-email": "someone@example.com" }));
=>
no credential: 401 not-agent-authenticated
wrong bearer: 401 not-agent-authenticated
session cookie: 401 not-agent-authenticated
hub identity header: 401 not-agent-authenticated
```

## Every resolve and refusal is logged with its purpose, never its value

```ts continue
const log = await accessLog();
print(log.map((line) => [line.box, line.event, line.secret, line.purpose, line.refusal ?? "-"].join(" ")).join("\n"));
print(`any line carries a value: ${JSON.stringify(log).includes("placeholder-")}`);
=>
test resolve weatherapi weather-trick -
test refuse mistral weather-trick agent-access-not-granted
test refuse no-such-service weather-trick unknown-secret
any line carries a value: false
```

A body that is not `{name, purpose}` is a 400 — the purpose is a short label
for that log, not a payload.

```ts continue
const bad = await ctx.request({
  method: "POST",
  url: "/api/secrets/resolve",
  payload: { name: "weatherapi" },
  headers: agentAuth,
});
print(`status: ${bad.statusCode} ${bad.body.kind}`);
=> status: 400 bad-request
```

`purpose` is constrained to that label shape — `^[a-z0-9][a-z0-9-]{0,39}$` — so
agent-authored callers cannot write a newline, a JSON blob, or a whole prompt
into the boxholder's access log:

```ts continue
async function badPurpose(purpose) {
  const reply = await ctx.request({
    method: "POST",
    url: "/api/secrets/resolve",
    payload: { name: "weatherapi", purpose },
    headers: agentAuth,
  });
  return `${reply.statusCode} ${reply.body.kind}`;
}
print(`newline: ${await badPurpose("weather\ntrick")}`);
print(`uppercase: ${await badPurpose("WeatherTrick")}`);
print(`empty: ${await badPurpose("")}`);
print(`too long: ${await badPurpose("a".repeat(41))}`);
print(`still logged nothing new: ${(await accessLog()).length}`);
=>
newline: 400 bad-request
uppercase: 400 bad-request
empty: 400 bad-request
too long: 400 bad-request
still logged nothing new: 3
```

```ts cleanup
await ctx.cleanup();
await rm(storeDir, { recursive: true, force: true });
process.env.BBX_SECRETS_FILE = priorStoreFile;
```
