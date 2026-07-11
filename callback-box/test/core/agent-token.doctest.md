# Agent loopback token

Tests for the per-box agent token (`.callback-box/agent-token`) that lets
box agents' `cb chat ...` loopback calls through the per-box auth wall in
production. See `src/core/agent/token.ts`.

```ts setup
import { getOrCreateAgentToken, verifyAgentBearer, resolveAgentToken } from "../../src/core/agent/token.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { makeTestServer } from "../helpers/doctest-server.js";
```

## Token generation is idempotent and stays put

```ts
const box = await makeTmpBox();
const first = getOrCreateAgentToken(box.root);
const second = getOrCreateAgentToken(box.root);
const onDisk = (await box.read(".callback-box/agent-token")).trim();
print(`length: ${first.length}`);
print(`stable: ${first === second}`);
print(`persisted: ${first === onDisk}`);
=>
length: 64
stable: true
persisted: true
```

Verification accepts exactly `Bearer <token>` and nothing else:

```ts continue
print(`good: ${verifyAgentBearer(box.root, `Bearer ${first}`)}`);
print(`wrong token: ${verifyAgentBearer(box.root, `Bearer ${"x".repeat(64)}`)}`);
print(`no scheme: ${verifyAgentBearer(box.root, first)}`);
print(`missing header: ${verifyAgentBearer(box.root, undefined)}`);
=>
good: true
wrong token: false
no scheme: false
missing header: false
```

```ts cleanup
await box.cleanup();
```

## Verification never creates the token file

Only spawners (buildScriptEnv) provision the token; a verify against a box
with no token must fail rather than mint one an attacker could race.

```ts
const box = await makeTmpBox();
print(`verify: ${verifyAgentBearer(box.root, "Bearer " + "x".repeat(64))}`);
const files = await box.list(".callback-box").catch(() => []);
print(`token file created: ${files.includes(".callback-box/agent-token")}`);
=>
verify: false
token file created: false
```

```ts cleanup
await box.cleanup();
```

## resolveAgentToken prefers the env var

```ts
process.env.CB_AGENT_TOKEN = "t".repeat(64);
const resolved = resolveAgentToken();
delete process.env.CB_AGENT_TOKEN;
resolved === "t".repeat(64)
=> true
```

## Auth wall: agent bearer passes where anonymous requests 401

With auth enabled, an unauthenticated loopback POST is rejected; the same
request with the box's agent bearer gets through the wall (and then fails
route validation — proof it reached the handler).

```ts
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
// registerAuthRoutes fails loudly on an ID-without-secret half-config
// (MissingOAuthClientSecretError), so the fake credentials must be a pair.
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
const ctx = await makeTestServer();
const anon = await ctx.request({ method: "POST", url: "/api/chat/self-note", payload: {} });
print(`anonymous: ${anon.statusCode} ${anon.body.error}`);
const token = getOrCreateAgentToken(ctx.boxRoot);
const authed = await ctx.request({
  method: "POST",
  url: "/api/chat/self-note",
  payload: {},
  headers: { authorization: `Bearer ${token}` },
});
print(`with bearer: ${authed.statusCode} ${authed.body.error}`);
const audio = await ctx.request({
  method: "POST",
  url: "/api/chat/last-audio/request",
  payload: { timeoutMs: 1 },
  headers: { authorization: `Bearer ${token}` },
});
print(`last-audio with bearer: ${audio.statusCode} ${audio.body.error}`);
=>
anonymous: 401 Not authenticated
with bearer: 400 body is required
last-audio with bearer: 504 no-client
```

```ts cleanup
delete process.env.GOOGLE_OAUTH_CLIENT_ID;
delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
await ctx.cleanup();
```
