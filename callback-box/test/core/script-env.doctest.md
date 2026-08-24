# Script environment

Tests for `buildScriptEnv` — the centralized env-var builder that every
box-scoped subprocess spawn site runs to get `CB_BOX_NAME` and
`CB_SERVER_URL` (plus any caller-specific additions).

```ts setup
import { buildScriptEnv, buildToolingScriptEnv, parsePublicUrl, registerBoxPublicUrl, unregisterBoxPublicUrl } from "../../src/core/script-env.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { PACKAGE_ROOT } from "../../src/lib/package-root.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
```

## parsePublicUrl

Full URL with slug:

```ts
const r = parsePublicUrl("https://cb.example.org/test1");
print(`serverUrl: ${r.serverUrl}`);
print(`boxName: ${r.boxName}`);
=>
serverUrl: https://cb.example.org
boxName: test1
```

Trailing slash on slug:

```ts
const r = parsePublicUrl("https://cb.example.org/test1/");
print(`serverUrl: ${r.serverUrl}`);
print(`boxName: ${r.boxName}`);
=>
serverUrl: https://cb.example.org
boxName: test1
```

No slug (server root):

```ts
const r = parsePublicUrl("http://localhost:3210");
print(`serverUrl: ${r.serverUrl}`);
print(`boxName: ${r.boxName}`);
=>
serverUrl: http://localhost:3210
boxName: null
```

Empty / missing:

```ts
parsePublicUrl("").serverUrl === null
=> true
```

```ts
parsePublicUrl(undefined).serverUrl === null
=> true
```

Unparseable input returns nulls (no throw):

```ts
const warnings: unknown[][] = [];
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => warnings.push(args);
const r = (() => {
  try { return parsePublicUrl("not a url"); }
  finally { console.warn = originalWarn; }
})();
print(`serverUrl: ${r.serverUrl}`);
print(`boxName: ${r.boxName}`);
print(`warnings: ${warnings.length}`);
=>
serverUrl: null
boxName: null
warnings: 1
```

## buildScriptEnv — with publicUrl configured

With a `publicUrl` in `config/box.json`, both env vars get populated:

```ts
const box = await makeTmpBox();
await fs.mkdir(path.join(box.root, "config"), { recursive: true });
await fs.writeFile(
  path.join(box.root, "config", "box.json"),
  JSON.stringify({ publicUrl: "https://cb.example.org/my-box" })
);
const env = await buildScriptEnv(box.root);
print(`CB_BOX_NAME: ${env.CB_BOX_NAME}`);
print(`CB_SERVER_URL: ${env.CB_SERVER_URL}`);
=>
CB_BOX_NAME: my-box
CB_SERVER_URL: https://cb.example.org
```

```ts cleanup
await box.cleanup();
```

## buildScriptEnv — ambient registration wins over box.json

When the webapp server registers a live public URL for a box (called
from `startServer` after listen), it takes priority over box.json. This
lets a local dev server supply `CB_BOX_NAME` / `CB_SERVER_URL` even
when `publicUrl` is absent from config:

```ts
const box = await makeTmpBox();
await fs.mkdir(path.join(box.root, "config"), { recursive: true });
await fs.writeFile(
  path.join(box.root, "config", "box.json"),
  JSON.stringify({ publicUrl: "https://stale.example.org/wrong-name" })
);
registerBoxPublicUrl(box.root, "http://localhost:3210/live-name");
const env = await buildScriptEnv(box.root);
unregisterBoxPublicUrl(box.root);
print(`CB_BOX_NAME: ${env.CB_BOX_NAME}`);
print(`CB_SERVER_URL: ${env.CB_SERVER_URL}`);
=>
CB_BOX_NAME: live-name
CB_SERVER_URL: http://localhost:3210
```

```ts cleanup
await box.cleanup();
```

## buildScriptEnv — ambient works without box.json at all

A box with no `config/box.json` picks up env vars from the ambient
registration:

```ts
const box = await makeTmpBox();
registerBoxPublicUrl(box.root, "http://localhost:3210/ephemeral-box");
const env = await buildScriptEnv(box.root);
unregisterBoxPublicUrl(box.root);
print(`CB_BOX_NAME: ${env.CB_BOX_NAME}`);
print(`CB_SERVER_URL: ${env.CB_SERVER_URL}`);
=>
CB_BOX_NAME: ephemeral-box
CB_SERVER_URL: http://localhost:3210
```

```ts cleanup
await box.cleanup();
```

## buildScriptEnv — no publicUrl, no PUBLIC_URL env

Without any configured URL, the env vars stay unset — a downstream
process that needs them will fail cleanly rather than using a default:

```ts
const box = await makeTmpBox();
const saved = process.env.PUBLIC_URL;
delete process.env.PUBLIC_URL;
const env = await buildScriptEnv(box.root);
if (saved !== undefined) process.env.PUBLIC_URL = saved;
print(`CB_BOX_NAME: ${env.CB_BOX_NAME ?? "(unset)"}`);
print(`CB_SERVER_URL: ${env.CB_SERVER_URL ?? "(unset)"}`);
=>
CB_BOX_NAME: (unset)
CB_SERVER_URL: (unset)
```

```ts cleanup
await box.cleanup();
```

## buildScriptEnv — additions merged in

Caller additions override / extend the env:

```ts
const box = await makeTmpBox();
await fs.mkdir(path.join(box.root, "config"), { recursive: true });
await fs.writeFile(
  path.join(box.root, "config", "box.json"),
  JSON.stringify({ publicUrl: "https://cb.example.org/my-box" })
);
const env = await buildScriptEnv(box.root, {
  CB_TRIGGERED_BY: "schedule",
  CUSTOM_KEY: "value",
});
print(`CB_BOX_NAME: ${env.CB_BOX_NAME}`);
print(`CB_TRIGGERED_BY: ${env.CB_TRIGGERED_BY}`);
print(`CUSTOM_KEY: ${env.CUSTOM_KEY}`);
=>
CB_BOX_NAME: my-box
CB_TRIGGERED_BY: schedule
CUSTOM_KEY: value
```

```ts cleanup
await box.cleanup();
```

Passing `undefined` deletes a key:

```ts
const box = await makeTmpBox();
process.env.SHOULD_VANISH = "still here";
const env = await buildScriptEnv(box.root, { SHOULD_VANISH: undefined });
delete process.env.SHOULD_VANISH;
env.SHOULD_VANISH === undefined
=> true
```

```ts cleanup
await box.cleanup();
```

## buildScriptEnv — inherits only allowlisted names

The subprocess env is a fail-closed allowlist, not a `process.env` spread with
a few names deleted. The hub's cross-box trust secrets (`CB_HUB_SECRET`,
`CB_DIAG_API_KEY`) would let an agent forge hub headers
(`x-cb-hub-authenticated-email`, `x-cb-hub-auth: off`) or the diag bearer at a
sibling box's loopback port; `CB_SESSION_SECRET` is the symmetric
cookie-signing key (verify == forge), so an agent holding it could mint a
`cb_session` for anyone; `ANTHROPIC_API_KEY` would silently bill the API
instead of the boxholder's subscription. Connector credentials
(`CALLBACK_MISTRAL_API_KEY`, `CALLBACK_DEEPGRAM_*`, `GEMINI_KEY`,
`GOOGLE_OAUTH_CLIENT_SECRET`, …) are withheld from agents too — and so is any
name nobody thought to list, which is the point of an allowlist.

```ts
const box = await makeTmpBox();
const poisoned = {
  CB_HUB_SECRET: "hub-secret-should-not-leak",
  CB_DIAG_API_KEY: "diag-key-should-not-leak",
  CB_SESSION_SECRET: "session-secret-should-not-leak",
  CB_BROWSE_API_KEY: "browse-key-should-not-leak",
  ANTHROPIC_API_KEY: "sk-should-not-leak",
  CALLBACK_MISTRAL_API_KEY: "mistral-should-not-leak",
  CALLBACK_DEEPGRAM_API_KEY: "deepgram-should-not-leak",
  GEMINI_KEY: "gemini-should-not-leak",
  SKE_GEMINI_API_KEY: "ske-gemini-should-not-leak",
  THINKING_OPENAI_API_KEY: "openai-should-not-leak",
  GOOGLE_OAUTH_CLIENT_ID: "google-id-should-not-leak",
  GOOGLE_OAUTH_CLIENT_SECRET: "google-secret-should-not-leak",
  NODE_ENV: "production",
  SOME_RANDOM_SECRET: "unknown-name-should-not-leak",
};
Object.assign(process.env, poisoned);
const env = await buildScriptEnv(box.root);
for (const key of Object.keys(poisoned)) delete process.env[key];
Object.keys(poisoned).filter((key) => env[key] !== undefined)
=> []
```

The essentials a spawned process actually needs are there: `PATH` (with
callback-box's own `bin/` prepended so `cb` resolves), `HOME`, and the
loopback `CB_AGENT_TOKEN` provisioned for this box.

```ts continue
const cbBin = path.join(PACKAGE_ROOT, "bin");
[
  env.PATH!.startsWith(`${cbBin}:`),
  env.HOME === process.env.HOME,
  typeof env.CB_AGENT_TOKEN === "string" && env.CB_AGENT_TOKEN.length > 0,
]
=> [
  true,
  true,
  true
]
```

`additions` are applied after the allowlist, so a caller can still hand a
subprocess a value the allowlist would have withheld:

```ts continue
const withAddition = await buildScriptEnv(box.root, { SOME_RANDOM_SECRET: "explicitly passed" });
withAddition.SOME_RANDOM_SECRET
=> explicitly passed
```

```ts cleanup
await box.cleanup();
```

## buildToolingScriptEnv — the `cb`-tooling profile adds connector credentials

Spawning the box's own tooling (`cb wakeup`, `cb finalize`, scheduled `runs:`
commands) means spawning the process that runs the connectors, so that profile
inherits the connector credentials — and nothing else the agent profile
withholds: the hub trust secrets and unknown names stay out.

```ts
const box = await makeTmpBox();
const vars = {
  CALLBACK_MISTRAL_API_KEY: "mistral-key",
  CALLBACK_DEEPGRAM_PROJECT: "deepgram-project",
  GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
  CB_HUB_SECRET: "hub-secret-should-not-leak",
  SOME_RANDOM_SECRET: "unknown-name-should-not-leak",
};
Object.assign(process.env, vars);
const env = await buildToolingScriptEnv(box.root);
for (const key of Object.keys(vars)) delete process.env[key];
print(`mistral: ${env.CALLBACK_MISTRAL_API_KEY}`);
print(`deepgram: ${env.CALLBACK_DEEPGRAM_PROJECT}`);
print(`google: ${env.GOOGLE_OAUTH_CLIENT_SECRET}`);
print(`hub secret: ${env.CB_HUB_SECRET ?? "(unset)"}`);
print(`random: ${env.SOME_RANDOM_SECRET ?? "(unset)"}`);
=>
mistral: mistral-key
deepgram: deepgram-project
google: google-secret
hub secret: (unset)
random: (unset)
```

```ts cleanup
await box.cleanup();
```
