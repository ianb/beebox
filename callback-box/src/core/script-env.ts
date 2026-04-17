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
 */

import { loadBoxConfig } from "../webapp/box-config.js";

interface BoxEnvPieces {
  serverUrl: string | null;
  boxName: string | null;
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
  } catch {
    return { serverUrl: null, boxName: null };
  }
  const serverUrl = `${url.protocol}//${url.host}`;
  const slug = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  return {
    serverUrl,
    boxName: slug.length > 0 ? slug : null,
  };
}

/**
 * Build a process environment for a subprocess spawned from this box.
 *
 * - Starts from `process.env`.
 * - Adds `CB_BOX_NAME` and `CB_SERVER_URL` when derivable from
 *   `config/box.json#publicUrl` (or `PUBLIC_URL` env fallback).
 * - Applies any caller-provided `additions` last (callers can override
 *   or explicitly unset — pass `undefined` to delete a key).
 */
export async function buildScriptEnv(
  boxRoot: string,
  additions?: Record<string, string | undefined>
): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env };

  const config = await loadBoxConfig(boxRoot);
  const publicUrl = config.publicUrl ?? process.env.PUBLIC_URL;
  const { serverUrl, boxName } = parsePublicUrl(publicUrl);
  if (serverUrl) env.CB_SERVER_URL = serverUrl;
  if (boxName) env.CB_BOX_NAME = boxName;

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
