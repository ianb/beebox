# Typed environment loader

`loadEnv(schema, source)` (`src/lib/env.ts`) validates env vars into typed data
at a boundary: it reports EVERY failing var at once, redacts secret values, and
coerces where the schema says to. Passing an explicit `source` means a test
never has to touch the real `process.env`.

```ts setup
import { z } from "zod";
import {
  loadEnv,
  serverEnvSchema,
  hubEnvSchema,
  cliEnvSchema,
  childProcessEnv,
  SECRET_ENV_NAMES,
  EnvValidationError,
} from "../src/lib/env.js";

// Capture an EnvValidationError so examples can inspect its `.problems`.
function loadErr(schema: z.ZodType, source: NodeJS.ProcessEnv): EnvValidationError | null {
  try { loadEnv(schema, source); return null; } catch (e) { return e instanceof EnvValidationError ? e : null; }
}
```

## Safe child-process inheritance

Local Git children retain basic process discovery and locale settings without
receiving ambient Git/editor overrides that subprocess guards reject.

```ts
const previousEditor = process.env.EDITOR;
process.env.EDITOR = "unsafe-editor";
const gitEnv = childProcessEnv({ GIT_INDEX_FILE: "/scratch/index" });
if (previousEditor === undefined) delete process.env.EDITOR;
else process.env.EDITOR = previousEditor;
JSON.stringify({ editor: "EDITOR" in gitEnv, index: gitEnv.GIT_INDEX_FILE, path: typeof gitEnv.PATH === "string" })
=> {"editor":false,"index":"/scratch/index","path":true}
```

## Coercion and empty-string-as-unset

A present `PORT` is coerced to a number; an empty or absent one reads as unset.

```ts
loadEnv(serverEnvSchema, { PORT: "8080" }).PORT
=> 8080

JSON.stringify(loadEnv(serverEnvSchema, { PORT: "" }).PORT ?? null)
=> null

JSON.stringify(loadEnv(serverEnvSchema, {}).PORT ?? null)
=> null
```

## All failures reported at once

Three malformed vars in one source produce three problems in one error — not a
fail-on-first-var.

```ts
const caught = loadErr(serverEnvSchema, { PORT: "notaport", PUBLIC_URL: "not a url", BBX_OWNER_EMAIL: "bad" });
JSON.stringify(caught?.problems.length)
=> 3
```

The names of all three failing vars appear in the message:

```ts continue
const names = caught!.problems.map((p) => p.split(":")[0]).sort();
JSON.stringify(names)
=> ["BBX_OWNER_EMAIL","PORT","PUBLIC_URL"]
```

A non-secret var echoes its received value to aid debugging:

```ts continue
caught!.problems.some((p) => p.includes('received: "notaport"'))
=> true
```

## Secret values are redacted, never echoed

`BBX_SESSION_SECRET` is in the secret set, so a validation failure on it shows
`<redacted>` and the raw value appears nowhere in the error.

```ts
const strictSecret = z.object({ BBX_SESSION_SECRET: z.string().min(32) });
const secretErr = loadErr(strictSecret, { BBX_SESSION_SECRET: "hunter2-too-short" });
const redacted = secretErr!.message.includes("<redacted>");
const leaked = secretErr!.message.includes("hunter2-too-short");
JSON.stringify({ redacted, leaked })
=> {"redacted":true,"leaked":false}
```

The secret-name set is the single source of truth for what gets redacted.

```ts
SECRET_ENV_NAMES.has("BBX_SESSION_SECRET")
=> true

SECRET_ENV_NAMES.has("PORT")
=> false
```

## Per-entrypoint schemas keep the parsed object narrow

Development surfaces are a positive, server-specific opt-in. Server and hub
entrypoints accept only literal `1`; unrelated CLI commands ignore the key.

```ts
loadEnv(serverEnvSchema, { BBX_DEV_SURFACES: "1" }).BBX_DEV_SURFACES
=> 1

loadEnv(hubEnvSchema, { BBX_DEV_SURFACES: "1" }).BBX_DEV_SURFACES
=> 1

JSON.stringify({
  serverRejects: loadErr(serverEnvSchema, { BBX_DEV_SURFACES: "true" }) !== null,
  hubRejects: loadErr(hubEnvSchema, { BBX_DEV_SURFACES: "development" }) !== null,
  cliIgnores: loadEnv(cliEnvSchema, { BBX_DEV_SURFACES: "not-for-this-command" }),
})
=> {"serverRejects":true,"hubRejects":true,"cliIgnores":{}}
```

`cliEnvSchema` only knows its own keys, so a server-only secret in the source is
ignored — it never lands in the CLI's typed env.

```ts
JSON.stringify(loadEnv(cliEnvSchema, { PORT: "3000", BBX_SESSION_SECRET: "leak-me" }))
=> {"PORT":3000}
```

`serverEnvSchema` does model that secret, so the same source keeps it:

```ts
JSON.stringify(loadEnv(serverEnvSchema, { BBX_SESSION_SECRET: "kept" }).BBX_SESSION_SECRET)
=> "kept"
```

The global credential-store override is common to the hub, server, and CLI;
keeping it in the base schema is what lets a validated hub pass the same path
to its children.

```ts
JSON.stringify(loadEnv(cliEnvSchema, { BBX_AUTH_FILE: "/srv/beebox/auth.json" }).BBX_AUTH_FILE)
=> "/srv/beebox/auth.json"
```
