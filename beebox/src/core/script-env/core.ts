/**
 * Script environment — builds the environment variables that every
 * subprocess spawned from within a box should inherit.
 *
 * Centralizes the `BBX_BOX_NAME` and `BBX_SERVER_URL` env vars so any
 * spawned process (scheduled script, sub-agent, chat process, reactor
 * task) can reliably reach the live chat endpoint via
 * `bbx chat self-note` without each spawn site re-implementing the
 * derivation.
 *
 * Source of truth is the live server's machine-owned endpoint registration,
 * then `_config/box.json`'s `publicUrl` field (which may also come from the
 * `PUBLIC_URL` env var as a fallback). `publicUrl`
 * encodes both the server base URL and the box slug in one string,
 * e.g. `https://bbx.example.org/test1` → server `https://bbx.example.org`,
 * name `test1`.
 *
 * When no live registration or configured URL exists the env vars are left
 * unset — child processes that need them will fail cleanly with a
 * "BBX_SERVER_URL is not set" error.
 *
 * What a subprocess inherits from the spawning server process is a
 * fail-closed ALLOWLIST (`script-env-allowlist.ts`), not a `process.env`
 * spread: a box agent must not inherit the server's credentials. Two
 * profiles — `buildScriptEnv` (agent-safe) and `buildToolingScriptEnv`
 * (adds connector credentials, for spawning the box's own `bbx` tooling).
 */

import { boxWorkEnvironment } from "../../lib/box-maintenance/admission.js";
import * as path from "node:path";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { loadBoxConfig } from "../box/config.js";
import { getOrCreateAgentToken } from "../agent/token.js";
import { PACKAGE_ROOT } from "../../lib/package-root.js";
import { pickBoxSubprocessEnv } from "./allowlist.js";
import type { SpawnProfile } from "../../lib/spawn-profile.js";
import { pathWithGitShim } from "./git-shim.js";
import { readServeEndpoint } from "../serve-endpoint.js";
import { onUnitHost } from "../../lib/unit-host.js";
import { getPublicUrl } from "../../lib/public-url.js";
import { slugOfBoxRoot } from "../../lib/box-slug.js";

// Path to Bee Box's own bin/ so subprocesses can find `bbx`.
// Prepended to PATH inside buildScriptEnv so every box-spawned subprocess
// works regardless of how the parent process was launched.
const BBX_BIN_DIR = path.join(PACKAGE_ROOT, "bin");

class BbxLauncherMissingError extends Error {
  constructor(launcher: string) {
    super(`Bee Box CLI launcher is missing or not executable: ${launcher}`);
    this.name = "BbxLauncherMissingError";
  }
}

/** Build the PATH handed to Bee Box children, failing if its launcher vanished. */
export async function prependBbxBinToPath(
  inheritedPath: string | undefined,
  binDir?: string,
): Promise<string> {
  const resolvedBinDir = binDir ?? BBX_BIN_DIR;
  const launcher = path.join(resolvedBinDir, "bbx");
  try {
    await access(launcher, fsConstants.X_OK);
  } catch (_error) {
    throw new BbxLauncherMissingError(launcher);
  }
  return `${resolvedBinDir}:${inheritedPath ?? ""}`;
}

interface BoxEnvPieces {
  serverUrl: string | null;
  boxName: string | null;
}

/**
 * Per-box live server URLs, populated at server startup. Preferred over
 * `_config/box.json#publicUrl` so that a running local dev server (which
 * knows its actual port and slug) can supply the env vars even when
 * `publicUrl` is absent from box config.
 *
 * Keyed by absolute box root path.
 */
const ambientPublicUrls = new Map<string, string>();

/**
 * Register the live public URL for a box. Called by `startServer` after
 * the server binds, once per served box. Format matches
 * `_config/box.json#publicUrl`: full URL including slug (e.g.
 * `http://localhost:3210/test1`).
 */
export function registerBoxPublicUrl(boxRoot: string, publicUrl: string): void {
  ambientPublicUrls.set(boxRoot, publicUrl);
}

/** Clear a registration (server shutdown or test cleanup). */
export function unregisterBoxPublicUrl(boxRoot: string): void {
  ambientPublicUrls.delete(boxRoot);
}

/**
 * Derive `{ serverUrl, boxName }` from a `publicUrl` string, or return
 * both null when the input is falsy / unparseable. Exported for tests.
 */
export function parsePublicUrl(publicUrl: string | undefined | null): BoxEnvPieces {
  if (!publicUrl) return { serverUrl: null, boxName: null };
  let url: URL;
  try {
    url = new URL(publicUrl);
  } catch (e) {
    console.warn(`Unparseable publicUrl, treating as no box env (${publicUrl}):`, e);
    return { serverUrl: null, boxName: null };
  }
  const serverUrl = `${url.protocol}//${url.host}`;
  const slug = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  return {
    serverUrl,
    boxName: slug.length > 0 ? slug : null,
  };
}

/** The three values `cli/lib/box-client.ts` reads to reach this box's own server. */
export interface BoxServerEnv {
  BBX_SERVER_URL?: string;
  BBX_BOX_NAME?: string;
  BBX_AGENT_TOKEN?: string;
}

/**
 * Where this box's server answers. Priority: live ambient > the serving
 * process's disk registration > on a unit host, the hub's base URL with this
 * box's slug > box.json publicUrl > PUBLIC_URL env. The disk registration
 * crosses the process boundary for CLI invocations while retaining the
 * box-root key. The live ambient lets a local dev server supply the env vars
 * without requiring publicUrl to be configured in box.json. On a unit host the
 * hub starts an idle box on demand, so its URL is valid whether this box's
 * server runs or not (a process the scheduler pass starts while it is idle).
 */
async function boxPublicUrl(boxRoot: string): Promise<string | undefined> {
  const ambient = ambientPublicUrls.get(boxRoot);
  if (ambient !== undefined) return ambient;
  const endpoint = await readServeEndpoint(boxRoot);
  if (endpoint?.publicUrl !== undefined) return endpoint.publicUrl;
  const hubBase = getPublicUrl("").replace(/\/+$/, "");
  if (onUnitHost() && hubBase !== "") return `${hubBase}/${slugOfBoxRoot(boxRoot)}`;
  const config = await loadBoxConfig(boxRoot);
  return config.publicUrl ?? process.env.BBX_PUBLIC_URL ?? process.env.PUBLIC_URL;
}

/**
 * `BBX_SERVER_URL`, `BBX_BOX_NAME`, and `BBX_AGENT_TOKEN` for this box, each
 * absent when it cannot be derived. Every box-spawned child gets them, and the
 * scheduler pass builds its own box client from them.
 */
export async function boxServerEnv(boxRoot: string): Promise<BoxServerEnv> {
  const out: BoxServerEnv = {};
  const { serverUrl, boxName } = parsePublicUrl(await boxPublicUrl(boxRoot));
  if (serverUrl) out.BBX_SERVER_URL = serverUrl;
  if (boxName) out.BBX_BOX_NAME = boxName;

  // Loopback auth: lets the subprocess's `bbx chat ...` calls through the
  // per-box auth wall in production. See core/agent-token.ts.
  try {
    out.BBX_AGENT_TOKEN = getOrCreateAgentToken(boxRoot);
  } catch (e) {
    console.warn(`[script-env] could not provision agent token for ${boxRoot}:`, e);
  }
  return out;
}

async function buildEnv(
  boxRoot: string,
  { additions, connectorCreds, profile }: {
    additions: Record<string, string | undefined> | undefined;
    connectorCreds: boolean;
    profile: Exclude<SpawnProfile, "unset">;
  }
): Promise<NodeJS.ProcessEnv> {
  const env = pickBoxSubprocessEnv(process.env, { connectorCreds });
  Object.assign(env, boxWorkEnvironment());

  // Which profile this child runs under, stated rather than inferred. It is
  // SET here, never inherited, so it is deliberately absent from the
  // allowlist: a child cannot be handed a parent's `tooling` marker by
  // accident. Credentialed `bbx` verbs run in-process only when this says
  // `tooling`; anything else delegates to the box's server or refuses
  // (`lib/spawn-profile.ts`). `additions` can still override it, which is how
  // a caller spawns a differently-profiled grandchild on purpose.
  env.BBX_SPAWN_PROFILE = profile;

  // Prepend Bee Box's bin/ so scripts can find `bbx` regardless of
  // how the parent process's PATH was set up.
  env.PATH = await prependBbxBinToPath(env.PATH);

  Object.assign(env, await boxServerEnv(boxRoot));

  if (additions) {
    for (const [k, v] of Object.entries(additions)) {
      if (v === undefined) {
        delete env[k];
      } else {
        env[k] = v;
      }
    }
  }

  // Walk fixtures: a `git` shim first on PATH stamps shell commits with box time.
  env.PATH = await pathWithGitShim({ boxRoot, searchPath: env.PATH });

  return env;
}

/**
 * Build a process environment for a subprocess spawned from this box —
 * agents, tricks, procedure shell steps, and anything else running
 * agent-authored code.
 *
 * - Starts from `SCRIPT_ENV_ALLOWLIST` applied to `process.env`; nothing else
 *   is inherited, connector credentials included.
 * - Adds `BBX_BOX_NAME` and `BBX_SERVER_URL` when derivable from the live
 *   endpoint registration, `_config/box.json#publicUrl`, or `PUBLIC_URL` env.
 * - Adds `BBX_AGENT_TOKEN` so the subprocess's `bbx chat …` calls get through
 *   its own box's auth wall.
 * - Sets `BBX_SPAWN_PROFILE=agent`, so credentialed `bbx` verbs delegate to the
 *   server rather than looking for a credential this profile withholds.
 * - Applies any caller-provided `additions` last (callers can override
 *   or explicitly unset — pass `undefined` to delete a key).
 */
export async function buildScriptEnv(
  boxRoot: string,
  additions?: Record<string, string | undefined>
): Promise<NodeJS.ProcessEnv> {
  return buildEnv(boxRoot, { additions, connectorCreds: false, profile: "agent" });
}

/**
 * The agent profile's inherited allowlist with `BBX_SPAWN_PROFILE=agent`, and
 * nothing `buildScriptEnv` injects: no server URL, agent token, or `bbx` on
 * PATH. For a child that runs box-authored code but needs no way back to the
 * box's server, such as the view metadata import, which also has no box when
 * the engine hosts the compile.
 */
export function agentAllowlistEnv(): NodeJS.ProcessEnv {
  return { ...pickBoxSubprocessEnv(process.env, { connectorCreds: false }), BBX_SPAWN_PROFILE: "agent" };
}

/**
 * `buildScriptEnv` plus `CONNECTOR_ENV_ALLOWLIST` — for spawn sites that run
 * the box's own tooling (`bbx wakeup`, `bbx finalize`, scheduled `runs:`
 * commands, which are overwhelmingly `bbx` invocations). Those children run the
 * connectors, so on an env-var-configured server they need the connector
 * credentials the agent profile withholds.
 *
 * Honest scope, per `docs/implemented-plans/secret-custody.md`: a scheduled-script card is
 * agent-authorable, so this profile is agent-*reachable* by writing a script
 * card and waiting for it to fire. What Track 1 closes is the trivial path —
 * the agent's own process env — not every path; Track 3 closes this one by
 * retiring env-var credentials for the store.
 *
 * Sets `BBX_SPAWN_PROFILE=tooling`, the one value that lets a credentialed
 * `bbx` verb do its work in-process.
 */
export async function buildToolingScriptEnv(
  boxRoot: string,
  additions?: Record<string, string | undefined>
): Promise<NodeJS.ProcessEnv> {
  return buildEnv(boxRoot, { additions, connectorCreds: true, profile: "tooling" });
}
