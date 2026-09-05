/** Resolve harness plugins shipped inside the beebox package. */

import { fileURLToPath } from "node:url";

export type HarnessPlugin = "claude" | "codex";

/** Absolute local-plugin path in both source and compiled package layouts. */
export function resolveHarnessPluginPath(plugin: HarnessPlugin): string {
  return fileURLToPath(
    new URL(`../../../plugins/beebox-${plugin}/`, import.meta.url),
  );
}
