// # Which process sees which credential variable
//
// Every credential environment variable beebox knows of, plus one name nobody
// lists, set in the parent environment with a recognizable ambient value. Each
// process that receives an environment from beebox code is then asked what it
// got, at the real process boundary where one exists (a child that writes out
// its own environment). A cell reads:
//
// - `I` inherited: the ambient value came through.
// - `J` injected: present with a value beebox set (a token from the store, a
//   provider endpoint, a minted secret).
// - `B` blanked: set to the empty string.
// - `-` absent.
//
// The warm-slot column reads `c` when a change in that variable alone stops a
// warm subprocess from serving the next chat, else `-`.
//
// This test pins the current answers. A refactor of where the lists live must
// leave every cell as it is; a change to a cell is a policy change and gets its
// own commit and reason.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildChildEnv } from "../../src/hub/supervisor/child-env.js";
import { defaultSpawnChild, spawnBoxChild, type SpawnChildFn } from "../../src/hub/supervisor/child-spawn.js";
import { renderBoxEnvFile } from "../../src/hub/box-env-file.js";
import { buildScriptEnv, buildToolingScriptEnv } from "../../src/core/script-env/core.js";
import { providerEnvAdditions } from "../../src/core/provider-env/core.js";
import { warmCompatible } from "../../src/services/claude-chat/core.js";
import { createClaudeCliService } from "../../src/services/claude-cli.js";
import { runClaudeQuery, type ClaudeQueryFunction } from "../../src/services/scan-vision-claude/query.js";
import { grantSecret, setSecret } from "../../src/core/secrets/lifecycle.js";
import { clearBoxConfigCache } from "../../src/core/box/config.js";
import { resolveProcedureModel } from "../../src/shared/agent-models.js";
import { boxSlug } from "../../src/lib/box-slug.js";
import type { ConsumeStreamOptions } from "../../src/core/agent/invoke/stream.js";
import * as auth from "../../src/core/agent/auth-preflight.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

/** Every credential name in the matrix. The last is listed nowhere in `src/`. */
const NAMES = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "BBX_SESSION_SECRET",
  "BBX_HUB_SECRET",
  "BBX_DIAG_API_KEY",
  "BBX_BROWSE_API_KEY",
  "BBX_AGENT_TOKEN",
  "BBX_VAPID_PRIVATE_KEY",
  "BBX_VAPID_PUBLIC_KEY",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_WORKSPACE_CLI_TOKEN",
  "BBX_MISTRAL_API_KEY",
  "BBX_DEEPGRAM_API_KEY",
  "BBX_DEEPGRAM_PROJECT",
  "BBX_OPENAI_API_KEY",
  "THINKING_OPENAI_API_KEY",
  "GEMINI_KEY",
  "SKE_GEMINI_API_KEY",
  "BBX_OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "BBX_UNLISTED_CREDENTIAL_SENTINEL",
] as const;

const ambient = (name: string) => `ambient-${name}`;
const AMBIENT_ENV: Record<string, string> = Object.fromEntries(NAMES.map((name) => [name, ambient(name)]));

type Env = Record<string, string | undefined>;

/** The string entries of an unknown value, so a captured env is typed without a cast. */
function asEnv(value: unknown): Env {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function cell(env: Env | null | undefined, name: string): string {
  const value = env?.[name];
  if (value === undefined) return "-";
  if (value === "") return "B";
  return value === ambient(name) ? "I" : "J";
}

const COLUMNS = [
  // Hub to `bbx serve`: the allowlist alone; a real child spawned with the hub's extras; the unit host's box.env.
  "hubAllow", "hubChild", "boxEnv",
  // Box subprocess profiles.
  "agent", "tooling",
  // What `providerEnvAdditions` adds, per provider and engine.
  "addFirst", "addGlm", "addOR", "addCodex", "addPi",
  // Whole environments at the spawn sites: a first-party Claude agent run, scan
  // vision's SDK call, a real Codex CLI with and without explicit additions.
  "runClaude", "scan", "codexNoEnv", "codexEnv",
  // The `claude` CLI's own commands: status with and without a box, login, logout.
  "status", "statusNoBox", "login", "logout",
  // The gws connector CLI.
  "gws",
  "warm",
] as const;
type Column = (typeof COLUMNS)[number];

function render(columns: Record<Column, (name: string) => string>): string[] {
  return NAMES.map((name) => `${name.padEnd(33)}${COLUMNS.map((column) => columns[column](name).padEnd(2)).join("").trimEnd()}`);
}

/** A script that writes its environment to `<dir>/<label>.json`; `label` is its argument after `auth`, else its own name. */
async function envRecorder(dir: string, script: { name: string; extra?: string }): Promise<string> {
  const { name, extra } = script;
  const file = join(dir, name);
  await writeFile(file, `#!${process.execPath}
const fs = require("node:fs");
const label = process.argv[2] === "auth" ? process.argv[3] : require("node:path").basename(process.argv[1]);
fs.writeFileSync(${JSON.stringify(dir)} + "/" + label + ".json", JSON.stringify(process.env));
${extra ?? ""}
`);
  await chmod(file, 0o755);
  return file;
}

/** Read and remove a recording, so a later read cannot see a stale one. */
async function recorded(dir: string, label: string): Promise<Env> {
  const file = join(dir, `${label}.json`);
  const env = asEnv(JSON.parse(await readFile(file, "utf-8")));
  await rm(file);
  return env;
}

void test("Which process sees which credential variable", async (t) => {
  // --- Setup: a box with its own store, the long-lived token, GLM and OpenRouter keys. ---
  const saved: Env = {};
  for (const name of [...NAMES, "BBX_SECRETS_FILE", "PATH", "BBX_CODEX_BINARY"]) saved[name] = process.env[name];
  t.teardown(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = value;
    }
  });
  process.env.BBX_SECRETS_FILE = join(await mkdtemp(join(tmpdir(), "bbx-secrets-")), "secrets.json");
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const kimi = { id: "moonshotai/kimi-k2-0905:exacto", label: "Kimi K2" };
  await mkdir(join(box.root, "_config"), { recursive: true });
  await writeFile(join(box.root, "_config/box.json"), JSON.stringify({ claudeCodeTelemetry: "on", openrouterModels: [kimi] }));
  clearBoxConfigCache(box.root);
  const slug = await boxSlug(box.root);
  for (const [name, value] of [
    ["claude-oauth-token", "sk-ant-oat01-fixture-token-of-sufficient-length-00"],
    ["glm", "placeholder-glm-key-of-sufficient-length"],
    ["openrouter", "placeholder-openrouter-key"],
  ] as const) {
    await setSecret({ name, value });
    await grantSecret({ slug, name, access: "server" });
  }
  const bin = await mkdtemp(join(tmpdir(), "bbx-env-recorders-"));
  Object.assign(process.env, AMBIENT_ENV);

  // --- Hub: the allowlist, and a real child through the hub's own spawn adapter. ---
  const hubAllow = buildChildEnv({ sourceEnv: { ...process.env }, hubExtras: {} });
  const recorder = await envRecorder(bin, { name: "hub-child" });
  const spawn: SpawnChildFn = (params) => defaultSpawnChild({ ...params, bbxBinary: recorder, args: [] });
  const spawned = await spawnBoxChild({ root: box.root, slug: "test1", hubSecret: "minted-hub-secret", spawn });
  await spawned.child;
  const hubChild = await recorded(bin, "hub-child");
  const boxEnv = Object.fromEntries(renderBoxEnvFile({ ...process.env }).split("\n")
    .filter((line) => /^[A-Z_][\dA-Z_]*=/.test(line))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at), String(JSON.parse(line.slice(at + 1)))];
    }));

  // --- Box subprocess profiles ---
  const agent = await buildScriptEnv(box.root);
  const tooling = await buildToolingScriptEnv(box.root);

  // --- Provider additions ---
  const glm = resolveProcedureModel({ engine: "claude", model: "strong", provider: "glm" });
  const addFirst = await providerEnvAdditions({ boxRoot: box.root, model: null, purpose: "test" });
  const addGlm = await providerEnvAdditions({ boxRoot: box.root, model: glm, purpose: "test" });
  const addOR = await providerEnvAdditions({ boxRoot: box.root, model: kimi.id, purpose: "test" });
  const addCodex = await providerEnvAdditions({ boxRoot: box.root, model: null, engine: "codex", purpose: "test" });
  const addPi = await providerEnvAdditions({ boxRoot: box.root, model: null, engine: "pi", purpose: "test" });

  // --- A first-party Claude agent run: the env handed to the SDK. ---
  let runClaude: Env = {};
  const { runAgent } = await t.mockImport("../../src/core/agent/invoke/run.ts", {
    "../../src/core/agent/auth-preflight.ts": { ...auth, checkClaudeAuth: async () => {} },
    "../../src/core/agent/invoke/stream.ts": { consumeAgentStream: async ({ queryOptions }: ConsumeStreamOptions) => {
      runClaude = asEnv(queryOptions.env);
      return { outputBuf: "", resultMessage: null, assignedSessionId: null, errorText: "synthetic stop", hadAssistantActivity: false };
    } },
  });
  await runAgent({ boxRoot: box.root, prompt: "test", systemPrompt: "" });

  // --- Scan vision's SDK call. ---
  let scan: Env = {};
  const query: ClaudeQueryFunction = (params) => {
    scan = asEnv(params.options?.env);
    throw new Error("recorded");
  };
  await runClaudeQuery({ boxRoot: box.root, content: [], model: "m", schema: {}, query }).catch(() => {});

  // --- Codex agent runs through the real Codex SDK, whose CLI is a recorder. ---
  process.env.BBX_CODEX_BINARY = await envRecorder(bin, { name: "codex", extra: "process.exit(1);" });
  const { runCodexAgent } = await t.mockImport("../../src/core/agent/codex-run/core.ts", {
    "../../src/core/agent/auth-preflight.ts": { ...auth, checkCodexAuth: async () => {} },
    "../../src/core/agent/ensure-codex-plugin.ts": { ensureCodexPluginInstalled: async () => {} },
  });
  await runCodexAgent({ boxRoot: box.root, prompt: "test", systemPrompt: "" });
  const codexNoEnv = await recorded(bin, "codex");
  await runCodexAgent({ boxRoot: box.root, prompt: "test", systemPrompt: "", env: {} });
  const codexEnv = await recorded(bin, "codex");

  // --- The `claude` CLI's own commands, through a recorder named `claude` first on PATH. ---
  await envRecorder(bin, { name: "claude", extra: `
if (process.argv[3] === "status") process.stdout.write("{}");
if (process.argv[3] === "login") { process.stdout.write("https://claude.ai/oauth/authorize?fixture=1\\n"); process.exit(0); }` });
  process.env.PATH = `${bin}:${saved.PATH ?? ""}`;
  await createClaudeCliService().authStatus();
  const statusNoBox = await recorded(bin, "status");
  await createClaudeCliService({ boxRoot: box.root }).authStatus();
  const status = await recorded(bin, "status");
  await createClaudeCliService().authLogin();
  const login = await recorded(bin, "login");
  await createClaudeCliService().authLogout();
  const logout = await recorded(bin, "logout");

  // --- gws: its child is replaced by one that records the env it was given. ---
  let gws: Env = {};
  const { runReadOnlyGws } = await t.mockImport("../../src/connectors/gmail/gws.ts", {
    "node:child_process": { spawn: (...args: [string, string[], { env?: unknown }]) => {
      gws = asEnv(args[2].env);
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
      setImmediate(() => child.emit("close", 0, null));
      return child;
    } },
  });
  await runReadOnlyGws({ args: ["gmail", "users", "messages", "list"], auth: { getAccessToken: async () => "minted-google-token" } });

  // --- Warm slot: does a difference in this name alone refuse the slot? ---
  const warm = (name: string) => {
    const base = { cwd: "/tmp", systemPrompt: "x" };
    return warmCompatible({ ...base, env: { [name]: "a" } }, { ...base, env: { [name]: "b" } }) ? "-" : "c";
  };

  const of = (env: Env | null | undefined) => (name: string) => cell(env, name);
  t.check(render({
    hubAllow: of(hubAllow), hubChild: of(hubChild), boxEnv: of(boxEnv),
    agent: of(agent), tooling: of(tooling),
    addFirst: of(addFirst), addGlm: of(addGlm), addOR: of(addOR), addCodex: of(addCodex), addPi: of(addPi),
    runClaude: of(runClaude), scan: of(scan), codexNoEnv: of(codexNoEnv), codexEnv: of(codexEnv),
    status: of(status), statusNoBox: of(statusNoBox), login: of(login), logout: of(logout),
    gws: of(gws),
    warm,
  }), [
    // hubAllow hubChild boxEnv | agent tooling | addFirst addGlm addOR addCodex addPi | runClaude scan codexNoEnv codexEnv | status statusNoBox login logout | gws | warm
    "CLAUDE_CODE_OAUTH_TOKEN          - - - - - J - - - - J J - - J - I I I c",
    "ANTHROPIC_API_KEY                - - - - - - - B - - - - - - I I I I I -",
    "ANTHROPIC_AUTH_TOKEN             - - - - - - J J - - - - - - I I I I I c",
    "ANTHROPIC_BASE_URL               - - - - - - J J - - - - - - I I I I I c",
    "BBX_SESSION_SECRET               - - - - - - - - - - - - - - I I I I I -",
    "BBX_HUB_SECRET                   - J - - - - - - - - - - - - I I I I I -",
    "BBX_DIAG_API_KEY                 I I I - - - - - - - - - - - I I I I I -",
    "BBX_BROWSE_API_KEY               - - - - - - - - - - - - - - I I I I I -",
    "BBX_AGENT_TOKEN                  - - - J J - - - - - J J J J I I I I I -",
    "BBX_VAPID_PRIVATE_KEY            I I I - - - - - - - - - - - I I I I I -",
    "BBX_VAPID_PUBLIC_KEY             I I I - - - - - - - - - - - I I I I I -",
    "GOOGLE_OAUTH_CLIENT_ID           - - - - - - - - - - - - - - I I I I I -",
    "GOOGLE_OAUTH_CLIENT_SECRET       - - - - - - - - - - - - - - I I I I I -",
    "GOOGLE_WORKSPACE_CLI_TOKEN       - - - - - - - - - - - - - - I I I I J -",
    "BBX_MISTRAL_API_KEY              - - - - - - - - - - - - - - I I I I I -",
    "BBX_DEEPGRAM_API_KEY             - - - - - - - - - - - - - - I I I I I -",
    "BBX_DEEPGRAM_PROJECT             - - - - - - - - - - - - - - I I I I I -",
    "BBX_OPENAI_API_KEY               - - - - - - - - - - - - - - I I I I I -",
    "THINKING_OPENAI_API_KEY          - - - - - - - - - - - - - - I I I I I -",
    "GEMINI_KEY                       - - - - - - - - - - - - - - I I I I I -",
    "SKE_GEMINI_API_KEY               - - - - - - - - - - - - - - I I I I I -",
    "BBX_OPENROUTER_API_KEY           - - - - - - - - - - - - - - I I I I I -",
    "OPENAI_API_KEY                   - - - - - - - - - - - - - - I I I I I -",
    "CODEX_API_KEY                    - - - - - - - - - - - - - - I I I I I -",
    "BBX_UNLISTED_CREDENTIAL_SENTINEL - - - - - - - - - - - - - - I I I I I -",
  ]);
});
