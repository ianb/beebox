# Script environment

Tests for `buildScriptEnv` — the centralized env-var builder that every
box-scoped subprocess spawn site runs to get `CB_BOX_NAME` and
`CB_SERVER_URL` (plus any caller-specific additions).

```ts setup
import { buildScriptEnv, parsePublicUrl, registerBoxPublicUrl, unregisterBoxPublicUrl } from "../../src/core/script-env.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
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
const r = parsePublicUrl("not a url");
print(`serverUrl: ${r.serverUrl}`);
print(`boxName: ${r.boxName}`);
=>
serverUrl: null
boxName: null
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

## buildScriptEnv — strips the hub's cross-box trust secrets

The child (`cb serve`) holds `CB_HUB_SECRET` and `CB_DIAG_API_KEY` to verify
hub-proxied requests, but a box agent spawned under it must NOT inherit them —
with either an agent could forge hub headers (`x-cb-hub-authenticated-email`,
`x-cb-hub-auth: off`) or the diag bearer straight to a sibling box's loopback
port and bypass identity + box ACLs. `CB_SESSION_SECRET` is the symmetric
cookie-signing key (verify == forge) — an agent holding it could mint a valid
`cb_session` for anyone. `ANTHROPIC_API_KEY` is stripped for the same
don't-inherit-power reason.

```ts
const box = await makeTmpBox();
process.env.CB_HUB_SECRET = "hub-secret-should-not-leak";
process.env.CB_DIAG_API_KEY = "diag-key-should-not-leak";
process.env.CB_SESSION_SECRET = "session-secret-should-not-leak";
process.env.ANTHROPIC_API_KEY = "sk-should-not-leak";
const env = await buildScriptEnv(box.root);
delete process.env.CB_HUB_SECRET;
delete process.env.CB_DIAG_API_KEY;
delete process.env.CB_SESSION_SECRET;
delete process.env.ANTHROPIC_API_KEY;
[
  env.CB_HUB_SECRET === undefined,
  env.CB_DIAG_API_KEY === undefined,
  env.CB_SESSION_SECRET === undefined,
  env.ANTHROPIC_API_KEY === undefined,
]
=> [
  true,
  true,
  true,
  true
]
```

```ts cleanup
await box.cleanup();
```
