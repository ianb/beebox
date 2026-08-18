/**
 * Script environment — builds the environment variables that every
 * subprocess spawned from within a box should inherit.
 *
 * Centralizes the `CB_BOX_NAME` and `CB_SERVER_URL` env vars so any
 * spawned process (scheduled script, sub-agent, chat process, reactor
 * task) can reliably reach the live chat endpoint via
 * `cb chat self-note` without each spawn site re-implementing the
 * derivation.
 *
 * Source of truth is `config/box.json`'s `publicUrl` field (which may
 * also come from the `PUBLIC_URL` env var as a fallback). `publicUrl`
 * encodes both the server base URL and the box slug in one string,
 * e.g. `https://cb.example.org/test1` → server `https://cb.example.org`,
 * name `test1`.
 *
 * When `publicUrl` is not configured the env vars are left unset —
 * child processes that need them will fail cleanly with a
 * "CB_SERVER_URL is not set" error.
 *
 * What a subprocess inherits from the spawning server process is a
 * fail-closed ALLOWLIST (`script-env-allowlist.ts`), not a `process.env`
 * spread: a box agent must not inherit the server's credentials. Two
 * profiles — `buildScriptEnv` (agent-safe) and `buildToolingScriptEnv`
 * (adds connector credentials, for spawning the box's own `cb` tooling).
 */

import * as path from "node:path";
import { loadBoxConfig } from "./box/config.js";
import { getOrCreateAgentToken } from "./agent/token.js";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import { pickBoxSubprocessEnv } from "./script-env-allowlist.js";

// Path to callback-box's own bin/ so subprocesses can find `cb`.
// Prepended to PATH inside buildScriptEnv so every box-spawned subprocess
// works regardless of how the parent process was launched.
const CB_BIN_DIR = path.join(PACKAGE_ROOT, "bin");

interface BoxEnvPieces {
  serverUrl: string | null;
  boxName: string | null;
}

/**
 * Per-box live server URLs, populated at server startup. Preferred over
 * `config/box.json#publicUrl` so that a running local dev server (which
 * knows its actual port and slug) can supply the env vars even when
 * `publicUrl` is absent from box config.
 *
 * Keyed by absolute box root path.
 */
const ambientPublicUrls = new Map<string, string>();

/**
 * Register the live public URL for a box. Called by `startServer` after
 * the server binds, once per served box. Format matches
 * `config/box.json#publicUrl`: full URL including slug (e.g.
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

async function buildEnv(
  boxRoot: string,
  { additions, connectorCreds }: {
    additions: Record<string, string | undefined> | undefined;
    connectorCreds: boolean;
  }
): Promise<NodeJS.ProcessEnv> {
  const env = pickBoxSubprocessEnv(process.env, { connectorCreds });

  // Prepend callback-box's bin/ so scripts can find `cb` regardless of
  // how the parent process's PATH was set up.
  env.PATH = `${CB_BIN_DIR}:${env.PATH ?? ""}`;

  // Priority: live ambient (running server) > box.json publicUrl > PUBLIC_URL env.
  // The live ambient lets a local dev server supply the env vars without
  // requiring publicUrl to be configured in box.json.
  const ambient = ambientPublicUrls.get(boxRoot);
  const config = await loadBoxConfig(boxRoot);
  const publicUrl = ambient ?? config.publicUrl ?? process.env.PUBLIC_URL;
  const { serverUrl, boxName } = parsePublicUrl(publicUrl);
  if (serverUrl) env.CB_SERVER_URL = serverUrl;
  if (boxName) env.CB_BOX_NAME = boxName;

  // Loopback auth: lets the subprocess's `cb chat ...` calls through the
  // per-box auth wall in production. See core/agent-token.ts.
  try {
    env.CB_AGENT_TOKEN = getOrCreateAgentToken(boxRoot);
  } catch (e) {
    console.warn(`[script-env] could not provision agent token for ${boxRoot}:`, e);
  }

  if (additions) {
    for (const [k, v] of Object.entries(additions)) {
      if (v === undefined) {
        delete env[k];
      } else {
        env[k] = v;
      }
    }
  }

  return env;
}

/**
 * Build a process environment for a subprocess spawned from this box —
 * agents, tricks, procedure shell steps, and anything else running
 * agent-authored code.
 *
 * - Starts from `SCRIPT_ENV_ALLOWLIST` applied to `process.env`; nothing else
 *   is inherited, connector credentials included.
 * - Adds `CB_BOX_NAME` and `CB_SERVER_URL` when derivable from
 *   `config/box.json#publicUrl` (or `PUBLIC_URL` env fallback).
 * - Adds `CB_AGENT_TOKEN` so the subprocess's `cb chat …` calls get through
 *   its own box's auth wall.
 * - Applies any caller-provided `additions` last (callers can override
 *   or explicitly unset — pass `undefined` to delete a key).
 */
export async function buildScriptEnv(
  boxRoot: string,
  additions?: Record<string, string | undefined>
): Promise<NodeJS.ProcessEnv> {
  return buildEnv(boxRoot, { additions, connectorCreds: false });
}

/**
 * `buildScriptEnv` plus `CONNECTOR_ENV_ALLOWLIST` — for spawn sites that run
 * the box's own tooling (`cb wakeup`, `cb finalize`, scheduled `runs:`
 * commands, which are overwhelmingly `cb` invocations). Those children run the
 * connectors, so on an env-var-configured server they need the connector
 * credentials the agent profile withholds.
 *
 * Honest scope, per `docs/plans/secret-custody.md`: a scheduled-script card is
 * agent-authorable, so this profile is agent-*reachable* by writing a script
 * card and waiting for it to fire. What Track 1 closes is the trivial path —
 * the agent's own process env — not every path; Track 3 closes this one by
 * retiring env-var credentials for the store.
 */
export async function buildToolingScriptEnv(
  boxRoot: string,
  additions?: Record<string, string | undefined>
): Promise<NodeJS.ProcessEnv> {
  return buildEnv(boxRoot, { additions, connectorCreds: true });
}
