# Script environment

Tests for `buildScriptEnv` — the centralized env-var builder that every
box-scoped subprocess spawn site runs to get `BBX_BOX_NAME` and
`BBX_SERVER_URL` (plus any caller-specific additions).

```ts setup
import { buildScriptEnv, buildToolingScriptEnv, parsePublicUrl, prependBbxBinToPath, registerBoxPublicUrl, unregisterBoxPublicUrl } from "../../src/core/script-env.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { PACKAGE_ROOT } from "../../src/lib/package-root.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
```

## parsePublicUrl

Full URL with slug:

```ts
const r = parsePublicUrl("https://bbx.example.org/test1");
print(`serverUrl: ${r.serverUrl}`);
print(`boxName: ${r.boxName}`);
=>
serverUrl: https://bbx.example.org
boxName: test1
```

Trailing slash on slug:

```ts
const r = parsePublicUrl("https://bbx.example.org/test1/");
print(`serverUrl: ${r.serverUrl}`);
print(`boxName: ${r.boxName}`);
=>
serverUrl: https://bbx.example.org
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

With a `publicUrl` in `_config/box.json`, both env vars get populated:

```ts
const box = await makeTmpBox();
await fs.mkdir(path.join(box.root, "_config"), { recursive: true });
await fs.writeFile(
  path.join(box.root, "_config", "box.json"),
  JSON.stringify({ publicUrl: "https://bbx.example.org/my-box" })
);
const env = await buildScriptEnv(box.root);
print(`BBX_BOX_NAME: ${env.BBX_BOX_NAME}`);
print(`BBX_SERVER_URL: ${env.BBX_SERVER_URL}`);
=>
BBX_BOX_NAME: my-box
BBX_SERVER_URL: https://bbx.example.org
```

```ts cleanup
await box.cleanup();
```

## buildScriptEnv — ambient registration wins over box.json

When the webapp server registers a live public URL for a box (called
from `startServer` after listen), it takes priority over box.json. This
lets a local dev server supply `BBX_BOX_NAME` / `BBX_SERVER_URL` even
when `publicUrl` is absent from config:

```ts
const box = await makeTmpBox();
await fs.mkdir(path.join(box.root, "_config"), { recursive: true });
await fs.writeFile(
  path.join(box.root, "_config", "box.json"),
  JSON.stringify({ publicUrl: "https://stale.example.org/wrong-name" })
);
registerBoxPublicUrl(box.root, "http://localhost:3210/live-name");
const env = await buildScriptEnv(box.root);
unregisterBoxPublicUrl(box.root);
print(`BBX_BOX_NAME: ${env.BBX_BOX_NAME}`);
print(`BBX_SERVER_URL: ${env.BBX_SERVER_URL}`);
=>
BBX_BOX_NAME: live-name
BBX_SERVER_URL: http://localhost:3210
```

```ts cleanup
await box.cleanup();
```

## buildScriptEnv — ambient works without box.json at all

A box with no `_config/box.json` picks up env vars from the ambient
registration:

```ts
const box = await makeTmpBox();
registerBoxPublicUrl(box.root, "http://localhost:3210/ephemeral-box");
const env = await buildScriptEnv(box.root);
unregisterBoxPublicUrl(box.root);
print(`BBX_BOX_NAME: ${env.BBX_BOX_NAME}`);
print(`BBX_SERVER_URL: ${env.BBX_SERVER_URL}`);
=>
BBX_BOX_NAME: ephemeral-box
BBX_SERVER_URL: http://localhost:3210
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
print(`BBX_BOX_NAME: ${env.BBX_BOX_NAME ?? "(unset)"}`);
print(`BBX_SERVER_URL: ${env.BBX_SERVER_URL ?? "(unset)"}`);
=>
BBX_BOX_NAME: (unset)
BBX_SERVER_URL: (unset)
```

```ts cleanup
await box.cleanup();
```

## buildScriptEnv — additions merged in

Caller additions override / extend the env:

```ts
const box = await makeTmpBox();
await fs.mkdir(path.join(box.root, "_config"), { recursive: true });
await fs.writeFile(
  path.join(box.root, "_config", "box.json"),
  JSON.stringify({ publicUrl: "https://bbx.example.org/my-box" })
);
const env = await buildScriptEnv(box.root, {
  BBX_TRIGGERED_BY: "schedule",
  CUSTOM_KEY: "value",
});
print(`BBX_BOX_NAME: ${env.BBX_BOX_NAME}`);
print(`BBX_TRIGGERED_BY: ${env.BBX_TRIGGERED_BY}`);
print(`CUSTOM_KEY: ${env.CUSTOM_KEY}`);
=>
BBX_BOX_NAME: my-box
BBX_TRIGGERED_BY: schedule
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
a few names deleted. The hub's cross-box trust secrets (`BBX_HUB_SECRET`,
`BBX_DIAG_API_KEY`) would let an agent forge hub headers
(`x-bbx-hub-authenticated-email`, `x-bbx-hub-auth: off`) or the diag bearer at a
sibling box's loopback port; `BBX_SESSION_SECRET` is the symmetric
cookie-signing key (verify == forge), so an agent holding it could mint a
`bbx_session` for anyone; `ANTHROPIC_API_KEY` would silently bill the API
instead of the boxholder's subscription. `GOOGLE_OAUTH_CLIENT_SECRET` — the
login surface's own configuration — is withheld too, and so is any name nobody
thought to list, which is the point of an allowlist. The connector keys that
used to be named here are no longer read from the environment at all
(`docs/implemented-plans/secret-custody.md`); they are exercised below anyway,
because an allowlist must keep withholding a name after the reason for naming
it goes away.

```ts
const box = await makeTmpBox();
const poisoned = {
  BBX_HUB_SECRET: "hub-secret-should-not-leak",
  BBX_DIAG_API_KEY: "diag-key-should-not-leak",
  BBX_SESSION_SECRET: "session-secret-should-not-leak",
  BBX_BROWSE_API_KEY: "browse-key-should-not-leak",
  ANTHROPIC_API_KEY: "sk-should-not-leak",
  BBX_MISTRAL_API_KEY: "mistral-should-not-leak",
  BBX_DEEPGRAM_API_KEY: "deepgram-should-not-leak",
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
Bee Box's own `bin/` prepended so `bbx` resolves), `HOME`, and the
loopback `BBX_AGENT_TOKEN` provisioned for this box.

```ts continue
const bbxBin = path.join(PACKAGE_ROOT, "bin");
[
  env.PATH!.startsWith(`${bbxBin}:`),
  env.HOME === process.env.HOME,
  typeof env.BBX_AGENT_TOKEN === "string" && env.BBX_AGENT_TOKEN.length > 0,
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

## PATH launcher contract

The package bin comes first for both child profiles, and a missing launcher is
an immediate error rather than a later "command not found" from a scenario.

```ts
const foreignBin = await fs.mkdtemp(path.join("/tmp", "bbx-foreign-bin-"));
const inherited = `${foreignBin}:/usr/bin`;
const agentPath = await prependBbxBinToPath(inherited);
const toolingBox = await makeTmpBox();
const toolingPath = (await buildToolingScriptEnv(toolingBox.root, {})).PATH!;
print(JSON.stringify({
  agent: agentPath.split(":")[0] === path.join(PACKAGE_ROOT, "bin"),
  tooling: toolingPath.split(":")[0] === path.join(PACKAGE_ROOT, "bin"),
  foreignAfter: agentPath.indexOf(foreignBin) > agentPath.indexOf(path.join(PACKAGE_ROOT, "bin")),
}));
await fs.rm(foreignBin, { recursive: true, force: true });
await toolingBox.cleanup();
=> {"agent":true,"tooling":true,"foreignAfter":true}
```

```ts
const missingBin = await fs.mkdtemp(path.join("/tmp", "bbx-missing-bin-"));
let message = "";
try {
  await prependBbxBinToPath("/usr/bin", missingBin);
} catch (error) {
  message = error instanceof Error ? error.message : String(error);
}
await fs.rm(missingBin, { recursive: true, force: true });
message.includes("Bee Box CLI launcher is missing")
=> true
```

## buildToolingScriptEnv — the `bbx`-tooling profile adds the store's path

Spawning the box's own tooling (`bbx wakeup`, `bbx finalize`, scheduled `runs:`
commands) means spawning the process that runs the connectors. What that profile
adds is the way to FIND the machine secret store, not the credentials in it —
the connectors resolve their own, under the box's grants. Everything the agent
profile withholds stays withheld, and connector keys that happen to be exported
are not inherited by either profile.

```ts
const box = await makeTmpBox();
const vars = {
  BBX_SECRETS_FILE: "/placeholder/secrets.json",
  BBX_GOOGLE_TOKENS_FILE: "/placeholder/google-tokens.json",
  BBX_MISTRAL_API_KEY: "mistral-should-not-leak",
  GOOGLE_OAUTH_CLIENT_SECRET: "google-secret-should-not-leak",
  BBX_HUB_SECRET: "hub-secret-should-not-leak",
  SOME_RANDOM_SECRET: "unknown-name-should-not-leak",
};
Object.assign(process.env, vars);
const env = await buildToolingScriptEnv(box.root);
for (const key of Object.keys(vars)) delete process.env[key];
print(`secret store path: ${env.BBX_SECRETS_FILE}`);
print(`google tokens path: ${env.BBX_GOOGLE_TOKENS_FILE}`);
print(`mistral: ${env.BBX_MISTRAL_API_KEY ?? "(unset)"}`);
print(`google client secret: ${env.GOOGLE_OAUTH_CLIENT_SECRET ?? "(unset)"}`);
print(`hub secret: ${env.BBX_HUB_SECRET ?? "(unset)"}`);
print(`random: ${env.SOME_RANDOM_SECRET ?? "(unset)"}`);
=>
secret store path: /placeholder/secrets.json
google tokens path: /placeholder/google-tokens.json
mistral: (unset)
google client secret: (unset)
hub secret: (unset)
random: (unset)
```

```ts cleanup
await box.cleanup();
```
