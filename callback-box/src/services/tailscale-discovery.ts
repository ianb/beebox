/**
 * Target auto-discovery for `cb tailscale setup`/`status`/`stop` (Track B).
 *
 * `--target <port>` is optional: when the operator omits it, we resolve the
 * front-most auth-gated loopback server from the hub config
 * (`~/.config/cb/hub.json`) and expose THAT port. Explicit `--target` always
 * wins over discovery. When neither is available we REFUSE with guidance rather
 * than guess — the dev router is never auto-targeted.
 *
 * This is the one place the discovery filesystem read happens (the command
 * boundary): it produces a concrete {@link TailscaleTarget} (or a refusal) that
 * the three service entrypoints then operate on directly, so no service fn
 * re-reads the config. Discovery only supplies a candidate port — every existing
 * posture guard (router refusal, `/auth/me` posture, non-loopback bind) still
 * decides whether that port may actually be exposed.
 */

import * as os from "node:os";

import { DEFAULT_HUB_HOST, DEFAULT_HUB_PORT, loadHubConfig } from "../hub/hub-config.js";
import { resolveTarget, type TargetResolution } from "./tailscale.js";

/** The default hub-config path — re-exported so the CLI can pass it as the
 *  discovery source without importing `hub-config` itself. */
export { defaultHubConfigPath } from "../hub/hub-config.js";

/** A per-line logger so the discovery announcement threads through the CLI's
 *  own `console.log` (and is capturable in doctests) rather than being emitted
 *  from deep in the module. */
export type LogLine = (line: string) => void;

/** Render an absolute path with the home directory collapsed to `~`, so a log
 *  line never prints a real home-dir path (which `path-leak-check` rejects and
 *  which is noise to the operator). */
function displayPath(absPath: string): string {
  const home = os.homedir();
  if (absPath === home) return "~";
  const prefix = home.endsWith("/") ? home : `${home}/`;
  return absPath.startsWith(prefix) ? `~/${absPath.slice(prefix.length)}` : absPath;
}

/**
 * Resolve a concrete loopback target, preferring an explicit `--target` and
 * otherwise auto-detecting the hub port from `hubConfigPath`. A missing or
 * unreadable hub config is "no hub configured" (not an error to propagate): we
 * refuse with guidance to pass `--target <port>` explicitly.
 */
export async function resolveTargetOrDiscover({
  target,
  hubConfigPath,
  log,
}: {
  target: string | undefined;
  hubConfigPath: string;
  log: LogLine;
}): Promise<TargetResolution> {
  // Explicit `--target` wins over discovery (and still validates the number).
  if (target !== undefined && target.trim() !== "") return resolveTarget(target);

  let config;
  try {
    config = await loadHubConfig(hubConfigPath);
  } catch (_e) {
    // A missing/unreadable/invalid hub.json simply means "no hub to discover" —
    // we do NOT surface the load error; we refuse cleanly and ask for --target.
    return {
      ok: false,
      message:
        `no --target given and no hub config found at ${displayPath(hubConfigPath)} to auto-detect a port. ` +
        "Pass `--target <port>` with the loopback port of the cb serve/hub to expose. " +
        "The dev router is never a valid target.",
    };
  }

  const port = config.port ?? DEFAULT_HUB_PORT;
  const host = config.host ?? DEFAULT_HUB_HOST;
  log(`Discovered hub on ${host}:${port} (from ${displayPath(hubConfigPath)}).`);
  return { ok: true, target: { port } };
}
