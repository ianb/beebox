// # Typed environment loader
//
// `loadEnv(schema, source)` (`src/lib/env.ts`) validates env vars into typed data
// at a boundary: it reports EVERY failing var at once, redacts secret values, and
// coerces where the schema says to. Passing an explicit `source` means a test
// never has to touch the real `process.env`.

import { test } from "tap";
import "agent-doctest/tap";
import { z } from "zod";
import {
  loadEnv,
  serverEnvSchema,
  hubEnvSchema,
  cliEnvSchema,
  childProcessEnv,
  SECRET_ENV_NAMES,
  EnvValidationError,
} from "../../src/lib/env.js";

// Capture an EnvValidationError so examples can inspect its `.problems`.
function loadErr(schema: z.ZodType, source: NodeJS.ProcessEnv): EnvValidationError | null {
  try { loadEnv(schema, source); return null; } catch (e) { return e instanceof EnvValidationError ? e : null; }
}

// ## Safe child-process inheritance
//
// Local Git children retain basic process discovery and locale settings without
// receiving ambient Git/editor overrides that subprocess guards reject.
void test("Local Git children retain basic process discovery and locale settings without...", async (t) => {
  // doctest:L32
  const previousEditor = process.env.EDITOR;
  process.env.EDITOR = "unsafe-editor";
  const gitEnv = childProcessEnv({ GIT_INDEX_FILE: "/scratch/index" });
  if (previousEditor === undefined) delete process.env.EDITOR;
  else process.env.EDITOR = previousEditor;
  t.check({ editor: "EDITOR" in gitEnv, index: gitEnv.GIT_INDEX_FILE, path: typeof gitEnv.PATH === "string" }, {
    editor: false,
    index: "/scratch/index",
    path: true,
  });
});

// ## Coercion and empty-string-as-unset
//
// A present `PORT` is coerced to a number; an empty or absent one reads as unset.
void test("A present PORT is coerced to a number; an empty or absent one reads as unset.", async (t) => {
  // doctest:L46
  t.check(loadEnv(serverEnvSchema, { PORT: "8080" }), { PORT: 8080 });

  // doctest:L49
  t.check(loadEnv(serverEnvSchema, { PORT: "" }), {});

  // doctest:L52
  t.check(loadEnv(serverEnvSchema, {}), {});
});

// ## All failures reported at once
//
// Three malformed vars in one source produce three problems in one error — not a
// fail-on-first-var.
void test("Three malformed vars in one source produce three problems in one error — not...", async (t) => {
  // doctest:L62
  const caught = loadErr(serverEnvSchema, { PORT: "notaport", PUBLIC_URL: "not a url", BBX_OWNER_EMAIL: "bad" });
  // The message names all three failing vars; a non-secret var echoes its received
  // value to aid debugging.
  t.check(caught, {
    name: "EnvValidationError",
    message: `Invalid environment (3 problems):
  - PUBLIC_URL: Invalid URL (received: "not a url")
  - PORT: Invalid input: expected number, received NaN (received: "notaport")
  - BBX_OWNER_EMAIL: Invalid email address (received: "bad")`,
    problems: [
      'PUBLIC_URL: Invalid URL (received: "not a url")',
      'PORT: Invalid input: expected number, received NaN (received: "notaport")',
      'BBX_OWNER_EMAIL: Invalid email address (received: "bad")',
    ],
  });
});

// ## Secret values are redacted, never echoed
//
// `BBX_SESSION_SECRET` is in the secret set, so a validation failure on it shows
// `<redacted>` and the raw value appears nowhere in the error.
void test("BBXSESSIONSECRET is in the secret set, so a validation failure on it shows <r...", async (t) => {
  // doctest:L88
  const strictSecret = z.object({ BBX_SESSION_SECRET: z.string().min(32) });
  const secretErr = loadErr(strictSecret, { BBX_SESSION_SECRET: "hunter2-too-short" });
  t.check(secretErr, {
    name: "EnvValidationError",
    message: `Invalid environment (1 problem):
  - BBX_SESSION_SECRET: invalid value (received: <redacted>)`,
    problems: ["BBX_SESSION_SECRET: invalid value (received: <redacted>)"],
  });
});

// The secret-name set is the single source of truth for what gets redacted.
void test("The secret-name set is the single source of truth for what gets redacted.", async (t) => {
  // doctest:L99
  t.check(
    SECRET_ENV_NAMES,
    new Set([
      "BBX_SESSION_SECRET",
      "BBX_HUB_SECRET",
      "BBX_DIAG_API_KEY",
      "BBX_VAPID_PUBLIC_KEY",
      "BBX_VAPID_PRIVATE_KEY",
      "GOOGLE_OAUTH_CLIENT_ID",
      "GOOGLE_OAUTH_CLIENT_SECRET",
    ]),
  );
});

// ## Per-entrypoint schemas keep the parsed object narrow
//
// Development surfaces are a positive, server-specific opt-in. Server and hub
// entrypoints accept only literal `1`; unrelated CLI commands ignore the key.
void test("Development surfaces are a positive, server-specific opt-in.", async (t) => {
  // doctest:L112
  t.check(loadEnv(serverEnvSchema, { BBX_DEV_SURFACES: "1" }), { BBX_DEV_SURFACES: "1" });

  // doctest:L115
  t.check(loadEnv(hubEnvSchema, { BBX_DEV_SURFACES: "1" }), { BBX_DEV_SURFACES: "1" });

  // doctest:L118
  t.check(
    {
      server: loadErr(serverEnvSchema, { BBX_DEV_SURFACES: "true" })?.problems,
      hub: loadErr(hubEnvSchema, { BBX_DEV_SURFACES: "development" })?.problems,
      cli: loadEnv(cliEnvSchema, { BBX_DEV_SURFACES: "not-for-this-command" }),
    },
    {
      server: ['BBX_DEV_SURFACES: Invalid input: expected "1" (received: "true")'],
      hub: ['BBX_DEV_SURFACES: Invalid input: expected "1" (received: "development")'],
      cli: {},
    },
  );
});

// `cliEnvSchema` only knows its own keys, so a server-only secret in the source is
// ignored — it never lands in the CLI's typed env.
void test("cliEnvSchema only knows its own keys, so a server-only secret in the source i...", async (t) => {
  // doctest:L130
  t.check(loadEnv(cliEnvSchema, { PORT: "3000", BBX_SESSION_SECRET: "leak-me" }), {
    PORT: 3000,
  });
});

// `serverEnvSchema` does model that secret, so the same source keeps it:
void test("serverEnvSchema does model that secret, so the same source keeps it:", async (t) => {
  // doctest:L137
  t.check(loadEnv(serverEnvSchema, { BBX_SESSION_SECRET: "kept" }), { BBX_SESSION_SECRET: "kept" });
});

// The global credential-store override is common to the hub, server, and CLI;
// keeping it in the base schema is what lets a validated hub pass the same path
// to its children.
void test("The global credential-store override is common to the hub, server, and CLI; k...", async (t) => {
  // doctest:L146
  t.check(loadEnv(cliEnvSchema, { BBX_AUTH_FILE: "/srv/beebox/auth.json" }), { BBX_AUTH_FILE: "/srv/beebox/auth.json" });
});
