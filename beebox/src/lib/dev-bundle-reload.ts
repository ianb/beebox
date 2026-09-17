import { stat } from "node:fs/promises";
import type { BigIntStats } from "node:fs";

export const DEV_BUNDLE_RELOAD_EXIT_CODE = 75;
export const DEV_BUNDLE_RELOAD_REQUEST = "reload-request";
export const DEV_BUNDLE_RELOAD_NOW = "reload-now";
export const DEV_BUNDLE_RELOAD_ABORTED = "reload-aborted";

let ignoredIdentity: string | undefined;

function identity(info: BigIntStats): string {
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}`;
}

export async function devBundleWasReplaced(): Promise<boolean> {
  // TODO(env-migration): These launcher-stamped values are intentionally read lazily so tests and re-exec boundaries can replace them.
  const bundlePath = process.env.BBX_DEV_BUNDLE_PATH;
  const loadedIdentity = process.env.BBX_DEV_BUNDLE_ID;
  if (!bundlePath || !loadedIdentity) return false;
  try {
    const currentIdentity = identity(await stat(bundlePath, { bigint: true }));
    return currentIdentity !== loadedIdentity && currentIdentity !== ignoredIdentity;
  } catch (_error) {
    // The build may briefly have no final artifact. Wait for a complete one.
    return false;
  }
}

export async function abandonDevBundleDrain(): Promise<void> {
  // TODO(env-migration): Read the launcher's current artifact path at the drain boundary.
  const bundlePath = process.env.BBX_DEV_BUNDLE_PATH;
  if (bundlePath) {
    try {
      ignoredIdentity = identity(await stat(bundlePath, { bigint: true }));
    } catch (_error) {
      // A later complete artifact will differ and may start a fresh drain.
    }
  }
}
