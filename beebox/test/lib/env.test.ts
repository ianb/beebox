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
  t.check(loadEnv(serverEnvSchema, { PORT: "8080" }).PORT, 8080);

  // doctest:L49
  t.check(loadEnv(serverEnvSchema, { PORT: "" }).PORT ?? null, null);

  // doctest:L52
  t.check(loadEnv(serverEnvSchema, {}).PORT ?? null, null);
});

// ## All failures reported at once
//
// Three malformed vars in one source produce three problems in one error — not a
// fail-on-first-var.
void test("Three malformed vars in one source produce three problems in one error — not...", async (t) => {
  // doctest:L62
  const caught = loadErr(serverEnvSchema, { PORT: "notaport", PUBLIC_URL: "not a url", BBX_OWNER_EMAIL: "bad" });
  t.check(caught?.problems.length, 3);

  // The names of all three failing vars appear in the message:

  // doctest:L70
  const names = caught!.problems.map((p) => p.split(":")[0]).toSorted();
  t.check(names, [
    "BBX_OWNER_EMAIL",
    "PORT",
    "PUBLIC_URL",
  ]);

  // A non-secret var echoes its received value to aid debugging:

  // doctest:L78
  await t.checkText(caught!.problems.some((p) => p.includes('received: "notaport"')), "true");
});

// ## Secret values are redacted, never echoed
//
// `BBX_SESSION_SECRET` is in the secret set, so a validation failure on it shows
// `<redacted>` and the raw value appears nowhere in the error.
void test("BBXSESSIONSECRET is in the secret set, so a validation failure on it shows <r...", async (t) => {
  // doctest:L88
  const strictSecret = z.object({ BBX_SESSION_SECRET: z.string().min(32) });
  const secretErr = loadErr(strictSecret, { BBX_SESSION_SECRET: "hunter2-too-short" });
  const redacted = secretErr!.message.includes("<redacted>");
  const leaked = secretErr!.message.includes("hunter2-too-short");
  t.check({ redacted, leaked }, {
    redacted: true,
    leaked: false,
  });
});

// The secret-name set is the single source of truth for what gets redacted.
void test("The secret-name set is the single source of truth for what gets redacted.", async (t) => {
  // doctest:L99
  await t.checkText(SECRET_ENV_NAMES.has("BBX_SESSION_SECRET"), "true");

  // doctest:L102
  await t.checkText(SECRET_ENV_NAMES.has("PORT"), "false");
});

// ## Per-entrypoint schemas keep the parsed object narrow
//
// Development surfaces are a positive, server-specific opt-in. Server and hub
// entrypoints accept only literal `1`; unrelated CLI commands ignore the key.
void test("Development surfaces are a positive, server-specific opt-in.", async (t) => {
  // doctest:L112
  await t.checkText(loadEnv(serverEnvSchema, { BBX_DEV_SURFACES: "1" }).BBX_DEV_SURFACES, "1");

  // doctest:L115
  await t.checkText(loadEnv(hubEnvSchema, { BBX_DEV_SURFACES: "1" }).BBX_DEV_SURFACES, "1");

  // doctest:L118
  t.check(
    {
      serverRejects: loadErr(serverEnvSchema, { BBX_DEV_SURFACES: "true" }) !== null,
      hubRejects: loadErr(hubEnvSchema, { BBX_DEV_SURFACES: "development" }) !== null,
      cliIgnores: loadEnv(cliEnvSchema, { BBX_DEV_SURFACES: "not-for-this-command" }),
    },
    {
    serverRejects: true,
    hubRejects: true,
    cliIgnores: {},
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
  t.check(loadEnv(serverEnvSchema, { BBX_SESSION_SECRET: "kept" }).BBX_SESSION_SECRET, "kept");
});

// The global credential-store override is common to the hub, server, and CLI;
// keeping it in the base schema is what lets a validated hub pass the same path
// to its children.
void test("The global credential-store override is common to the hub, server, and CLI; k...", async (t) => {
  // doctest:L146
  t.check(loadEnv(cliEnvSchema, { BBX_AUTH_FILE: "/srv/beebox/auth.json" }).BBX_AUTH_FILE, "/srv/beebox/auth.json");
});
