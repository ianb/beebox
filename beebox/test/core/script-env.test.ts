// # Script environment
//
// Tests for `buildScriptEnv` — the centralized env-var builder that every
// box-scoped subprocess spawn site runs to get `BBX_BOX_NAME` and
// `BBX_SERVER_URL` (plus any caller-specific additions).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { boxServerEnv, buildScriptEnv, buildToolingScriptEnv, parsePublicUrl, prependBbxBinToPath, registerBoxPublicUrl, unregisterBoxPublicUrl } from "../../src/core/script-env/core.js";
import { serveEndpointPath, writeServeEndpoint } from "../../src/core/serve-endpoint.js";
import { spawnProfile } from "../../src/lib/spawn-profile.js";
import { makeTmpBox, type TmpBox } from "../helpers/test-helpers.js";
import { PACKAGE_ROOT } from "../../src/lib/package-root.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// ## parsePublicUrl
//
// A public URL splits into the server origin and the box slug. A trailing slash
// on the slug is dropped; a URL with no slug (server root) has no box name;
// empty input has neither. Unparseable input returns nulls (no throw) and logs
// one warning.
void test("A public URL splits into the server origin and the box slug.", async (t) => {
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);
  const results: Array<{ input: string; parsed: ReturnType<typeof parsePublicUrl>; warnings: number }> = [];
  try {
    for (const input of ["https://bbx.example.org/test1", "https://bbx.example.org/test1/", "http://localhost:3210", "", "not a url"]) {
      results.push({ input, parsed: parsePublicUrl(input), warnings: warnings.length });
    }
  } finally {
    console.warn = originalWarn;
  }

  t.check(results, [
    { input: "https://bbx.example.org/test1", parsed: { serverUrl: "https://bbx.example.org", boxName: "test1" }, warnings: 0 },
    { input: "https://bbx.example.org/test1/", parsed: { serverUrl: "https://bbx.example.org", boxName: "test1" }, warnings: 0 },
    { input: "http://localhost:3210", parsed: { serverUrl: "http://localhost:3210", boxName: null }, warnings: 0 },
    { input: "", parsed: { serverUrl: null, boxName: null }, warnings: 0 },
    { input: "not a url", parsed: { serverUrl: null, boxName: null }, warnings: 1 },
  ]);
});

// ## buildScriptEnv — where the box name and server URL come from
//
// `BBX_BOX_NAME` and `BBX_SERVER_URL` come from, in priority order:
//
// - the ambient registration the webapp server makes after listen
//   (`registerBoxPublicUrl`), which lets a local dev server supply them even when
//   `publicUrl` is absent from config, and wins over a stale `box.json`;
// - `publicUrl` in `_config/box.json`.
//
// Without any configured URL the env vars stay unset — a downstream process that
// needs them will fail cleanly rather than using a default. Malformed disk state
// (a garbled serve-endpoint file) is ignored rather than becoming a guessed
// endpoint.
void test("BBXBOXNAME and BBXSERVERURL come from, in priority order:", async (t) => {
  async function writeBoxJson(box: TmpBox, publicUrl: string) {
    await fs.mkdir(path.join(box.root, "_config"), { recursive: true });
    await fs.writeFile(path.join(box.root, "_config", "box.json"), JSON.stringify({ publicUrl }));
  }
  const cases: Array<[string, (box: TmpBox) => Promise<Record<string, string | undefined>>]> = [
    ["box.json publicUrl", async (box: TmpBox) => {
      await writeBoxJson(box, "https://bbx.example.org/my-box");
      return buildScriptEnv(box.root);
    }],
    ["ambient registration beats box.json", async (box: TmpBox) => {
      await writeBoxJson(box, "https://stale.example.org/wrong-name");
      registerBoxPublicUrl(box.root, "http://localhost:3210/live-name");
      try { return await buildScriptEnv(box.root); }
      finally { unregisterBoxPublicUrl(box.root); }
    }],
    ["nothing configured", async (box: TmpBox) => {
      const saved = process.env.PUBLIC_URL;
      delete process.env.PUBLIC_URL;
      try { return await buildScriptEnv(box.root); }
      finally { if (saved !== undefined) process.env.PUBLIC_URL = saved; }
    }],
    ["malformed serve endpoint file", async (box: TmpBox) => {
      await fs.mkdir(path.join(box.root, ".beebox"), { recursive: true });
      await fs.writeFile(serveEndpointPath(box.root), "not-json");
      return buildScriptEnv(box.root);
    }],
  ];
  const results: Array<{ label: string; BBX_BOX_NAME: string | undefined; BBX_SERVER_URL: string | undefined }> = [];
  for (const [label, build] of cases) {
    const box = await makeTmpBox();
    const env = await build(box);
    results.push({ label, BBX_BOX_NAME: env.BBX_BOX_NAME, BBX_SERVER_URL: env.BBX_SERVER_URL });
    await box.cleanup();
  }

  t.check(results, [
    { label: "box.json publicUrl", BBX_BOX_NAME: "my-box", BBX_SERVER_URL: "https://bbx.example.org" },
    { label: "ambient registration beats box.json", BBX_BOX_NAME: "live-name", BBX_SERVER_URL: "http://localhost:3210" },
    { label: "nothing configured", BBX_BOX_NAME: undefined, BBX_SERVER_URL: undefined },
    { label: "malformed serve endpoint file", BBX_BOX_NAME: undefined, BBX_SERVER_URL: undefined },
  ]);
});

// ## buildScriptEnv — disk registration crosses a process boundary
//
// The server writes the registration after binding. A fresh CLI process has no
// ambient map, but it can read the machine-owned registration:
void test("The server writes the registration after binding.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await writeServeEndpoint(box.root, { pid: 123, publicUrl: "http://127.0.0.1:60157/ephemeral-box" });
  const env = await buildScriptEnv(box.root);
  t.check({ BBX_BOX_NAME: env.BBX_BOX_NAME, BBX_SERVER_URL: env.BBX_SERVER_URL }, {
    BBX_BOX_NAME: "ephemeral-box",
    BBX_SERVER_URL: "http://127.0.0.1:60157",
  });
  t.checkText((await fs.readFile(serveEndpointPath(box.root), "utf8")).trim(), "{\"pid\":123,\"publicUrl\":\"http://127.0.0.1:60157/ephemeral-box\"}");
});

// ## buildScriptEnv — additions merged in
//
// Caller additions override / extend the env, and passing `undefined` deletes a
// key:
void test("Caller additions override / extend the env, and passing undefined deletes a key:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await fs.mkdir(path.join(box.root, "_config"), { recursive: true });
  await fs.writeFile(
    path.join(box.root, "_config", "box.json"),
    JSON.stringify({ publicUrl: "https://bbx.example.org/my-box" })
  );
  process.env.SHOULD_VANISH = "still here";
  const env = await buildScriptEnv(box.root, {
    BBX_TRIGGERED_BY: "schedule",
    CUSTOM_KEY: "value",
    SHOULD_VANISH: undefined,
  });
  delete process.env.SHOULD_VANISH;
  t.check({
    BBX_BOX_NAME: env.BBX_BOX_NAME,
    BBX_TRIGGERED_BY: env.BBX_TRIGGERED_BY,
    CUSTOM_KEY: env.CUSTOM_KEY,
    SHOULD_VANISH: env.SHOULD_VANISH,
  }, {
    BBX_BOX_NAME: "my-box",
    BBX_TRIGGERED_BY: "schedule",
    CUSTOM_KEY: "value",
    SHOULD_VANISH: undefined,
  });
});

// ## buildScriptEnv — inherits only allowlisted names
//
// The subprocess env is a fail-closed allowlist, not a `process.env` spread with
// a few names deleted. The hub's cross-box trust secrets (`BBX_HUB_SECRET`,
// `BBX_DIAG_API_KEY`) would let an agent forge hub headers
// (`x-bbx-hub-authenticated-email`, `x-bbx-hub-auth: off`) or the diag bearer at a
// sibling box's loopback port; `BBX_SESSION_SECRET` is the symmetric
// cookie-signing key (verify == forge), so an agent holding it could mint a
// `bbx_session` for anyone; `ANTHROPIC_API_KEY` would silently bill the API
// instead of the boxholder's subscription. `GOOGLE_OAUTH_CLIENT_SECRET` — the
// login surface's own configuration — is withheld too, and so is any name nobody
// thought to list, which is the point of an allowlist. The connector keys that
// used to be named here are no longer read from the environment at all
// (`docs/implemented-plans/secret-custody.md`); they are exercised below anyway,
// because an allowlist must keep withholding a name after the reason for naming
// it goes away.
void test("The subprocess env is a fail-closed allowlist, not a process.env spread with...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
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
  t.check(Object.keys(poisoned).filter((key) => env[key] !== undefined), []);

  // The essentials a spawned process actually needs are there: `PATH` (with
  // Bee Box's own `bin/` prepended so `bbx` resolves), `HOME`, and the
  // loopback `BBX_AGENT_TOKEN` provisioned for this box.

  const bbxBin = path.join(PACKAGE_ROOT, "bin");
  t.check(
    { PATH: env.PATH, HOME: env.HOME, BBX_AGENT_TOKEN: env.BBX_AGENT_TOKEN },
    { PATH: str`${bbxBin}:${any(String)}`, HOME: process.env.HOME, BBX_AGENT_TOKEN: any(String).matches(/./) },
  );

  // `additions` are applied after the allowlist, so a caller can still hand a
  // subprocess a value the allowlist would have withheld:

  const withAddition = await buildScriptEnv(box.root, { SOME_RANDOM_SECRET: "explicitly passed" });
  t.check(withAddition.SOME_RANDOM_SECRET, "explicitly passed");
});

// ## PATH launcher contract
//
// The package bin comes first for both child profiles, and a missing launcher is
// an immediate error rather than a later "command not found" from a scenario.
void test("The package bin comes first for both child profiles, and a missing launcher i...", async (t) => {
  const foreignBin = await fs.mkdtemp(path.join("/tmp", "bbx-foreign-bin-"));
  const inherited = `${foreignBin}:/usr/bin`;
  const agentPath = await prependBbxBinToPath(inherited);
  const toolingBox = await makeTmpBox();
  const toolingPath = (await buildToolingScriptEnv(toolingBox.root, {})).PATH!;
  await fs.rm(foreignBin, { recursive: true, force: true });
  await toolingBox.cleanup();
  const bbxBin = path.join(PACKAGE_ROOT, "bin");
  t.check(agentPath.split(":"), [bbxBin, foreignBin, "/usr/bin"]);
  t.check(toolingPath, str`${bbxBin}:${any(String)}`);
});

void test("PATH launcher contract", async (t) => {
  const missingBin = await fs.mkdtemp(path.join("/tmp", "bbx-missing-bin-"));
  let message = "";
  try {
    await prependBbxBinToPath("/usr/bin", missingBin);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  await fs.rm(missingBin, { recursive: true, force: true });
  t.check(message, `Bee Box CLI launcher is missing or not executable: ${missingBin}/bbx`);
});

// ## buildToolingScriptEnv — the `bbx`-tooling profile adds the store's path
//
// Spawning the box's own tooling (`bbx wakeup`, `bbx finalize`, scheduled `runs:`
// commands) means spawning the process that runs the connectors. What that profile
// adds is the way to FIND the machine secret store, not the credentials in it —
// the connectors resolve their own, under the box's grants. Everything the agent
// profile withholds stays withheld, and connector keys that happen to be exported
// are not inherited by either profile.
void test("Spawning the box's own tooling (bbx wakeup, bbx finalize, scheduled runs: com...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
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
  t.check({
    secretStorePath: env.BBX_SECRETS_FILE,
    googleTokensPath: env.BBX_GOOGLE_TOKENS_FILE,
    mistral: env.BBX_MISTRAL_API_KEY,
    googleClientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    hubSecret: env.BBX_HUB_SECRET,
    random: env.SOME_RANDOM_SECRET,
  }, {
    secretStorePath: "/placeholder/secrets.json",
    googleTokensPath: "/placeholder/google-tokens.json",
    mistral: undefined,
    googleClientSecret: undefined,
    hubSecret: undefined,
    random: undefined,
  });
});

// ## The spawn-profile marker
//
// Each profile stamps `BBX_SPAWN_PROFILE`, so a credentialed `bbx` verb branches
// on who spawned it rather than on what it can happen to read. The marker is set,
// never inherited: a `tooling` parent's value does not reach an agent child, which
// is the whole point (`docs/plans/agent-capability-delegation.md`).
void test("Each profile stamps BBXSPAWNPROFILE, so a credentialed bbx verb branches on w...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  process.env.BBX_SPAWN_PROFILE = "tooling";
  const agentEnv = await buildScriptEnv(box.root);
  const toolingEnv = await buildToolingScriptEnv(box.root);
  delete process.env.BBX_SPAWN_PROFILE;
  t.check({ agent: agentEnv.BBX_SPAWN_PROFILE, tooling: toolingEnv.BBX_SPAWN_PROFILE }, {
    agent: "agent",
    tooling: "tooling",
  });

  // `spawnProfile()` reads it back, and anything it does not recognize — a typo, an
  // unset variable, a shell that was never given one — is `unset`, which callers
  // treat exactly like `agent`. Fail-closed: the only value that unlocks in-process
  // credential use is the one spelled `tooling`.

  const readBack = (value: string | undefined) => {
    const saved = process.env.BBX_SPAWN_PROFILE;
    if (value === undefined) delete process.env.BBX_SPAWN_PROFILE;
    else process.env.BBX_SPAWN_PROFILE = value;
    try { return spawnProfile(); }
    finally {
      if (saved === undefined) delete process.env.BBX_SPAWN_PROFILE;
      else process.env.BBX_SPAWN_PROFILE = saved;
    }
  };
  t.check(["agent", "tooling", "Tooling", "", undefined].map(readBack), [
    "agent",
    "tooling",
    "unset",
    "unset",
    "unset",
  ]);

  // A caller that means it can still override the marker through `additions` — the
  // same escape hatch every other derived name has.

  t.check((await buildScriptEnv(box.root, { BBX_SPAWN_PROFILE: "tooling" })).BBX_SPAWN_PROFILE, "tooling");
});

// ## On a unit host, the box name comes from the box's path
//
// A process the scheduler pass starts while the box server is idle finds no
// endpoint file, and the host's `BBX_PUBLIC_URL` has no box path. On a unit host
// the hub starts an idle box for a request to `<base>/<slug>`, so `boxServerEnv`
// names that URL, with the slug from the box's home (`<home>/box`). See
// docs/implemented-plans/on-demand-job-triggers.md, Track A.
void test("On a unit host, the box name comes from the box's path", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-unit-env-"));
  const boxRoot = path.join(home, "fam", "box");
  await fs.mkdir(boxRoot, { recursive: true });
  const saved = { unit: process.env.BBX_UNIT_HOST, url: process.env.BBX_PUBLIC_URL };
  process.env.BBX_UNIT_HOST = "1";
  process.env.BBX_PUBLIC_URL = "https://h";
  t.teardown(async () => {
    restoreEnv("BBX_UNIT_HOST", saved.unit);
    restoreEnv("BBX_PUBLIC_URL", saved.url);
    await fs.rm(home, { recursive: true, force: true });
  });

  const env = await boxServerEnv(boxRoot);
  t.check(env, { BBX_SERVER_URL: "https://h", BBX_BOX_NAME: "fam", BBX_AGENT_TOKEN: any(String) });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
