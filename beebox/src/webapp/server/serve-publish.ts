/**
 * What a listening `bbx engine serve` tells the box and the operator about
 * where it is: the endpoint file each box's subprocesses read for
 * `BBX_SERVER_URL` (`core/script-env`), the in-process registration of the
 * same URL, and the startup lines.
 */

import type { BoxSpec } from "../server-types.js";
import { registerBoxPublicUrl } from "../../core/script-env/core.js";
import { writeServeEndpoint } from "../../core/serve-endpoint.js";
import { getPublicUrl } from "../../lib/public-url.js";
import { describeListenTarget, type ListenTarget } from "./listen-target.js";

/**
 * The URL base this server's boxes are reached at by their own subprocesses:
 * the bound address for TCP (as before), and for a Unix socket the public URL
 * (`BBX_PUBLIC_URL`), the hub's front door, since a socket has no URL and the
 * hub proxies an agent-bearer request back to it. `undefined`: nothing to
 * publish.
 */
export function listenBaseUrl(target: ListenTarget): string | undefined {
  if (target.kind === "tcp") return `http://${target.host}:${target.port}`;
  const fromEnv = getPublicUrl("");
  return fromEnv === "" ? undefined : fromEnv.replace(/\/+$/, "");
}

/**
 * Register each served box's live URL so subprocess spawns pick up
 * `BBX_BOX_NAME` / `BBX_SERVER_URL` through `buildScriptEnv` without
 * `publicUrl` in `_config/box.json`, record the endpoint on disk for CLI
 * invocations, and print where the server is.
 */
export async function publishServeEndpoints(params: {
  boxes: BoxSpec[];
  target: ListenTarget;
  baseUrl: string | undefined;
}): Promise<void> {
  const { boxes, target, baseUrl } = params;
  const socket = target.kind === "tcp" ? undefined : target.path;
  if (baseUrl === undefined) {
    console.warn("No BBX_PUBLIC_URL: box subprocesses get no BBX_SERVER_URL and cannot call this server.");
  }
  for (const box of boxes) {
    const publicUrl = baseUrl === undefined ? undefined : `${baseUrl}/${box.slug}`;
    await writeServeEndpoint(box.boxRoot, {
      pid: process.pid,
      ...(publicUrl !== undefined && { publicUrl }),
      ...(socket !== undefined && { socket }),
    });
    if (publicUrl !== undefined) registerBoxPublicUrl(box.boxRoot, publicUrl);
  }
  console.log(`Server running at ${describeListenTarget(target)}`);
  for (const box of boxes) {
    console.log(`  ${box.slug}: ${baseUrl === undefined ? `/${box.slug}/` : `${baseUrl}/${box.slug}/`}`);
  }
}
