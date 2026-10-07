/** Resolve the one package-pinned Codex executable used by every Bee Box path. */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function codexBinaryPath(): string {
  // This diagnostic test override is intentionally read at the call boundary:
  // tests change it between calls, while validated startup configuration is
  // captured once by the entrypoint environment schemas.
  return process.env.BBX_CODEX_BINARY ?? require.resolve("@openai/codex/bin/codex.js");
}

/**
 * Codex settings every Bee Box invocation forces. The box pins Codex's
 * version, so the update check is noise, and nothing here files feedback.
 */
export const CODEX_FIXED_CONFIG = { feedback: { enabled: false }, check_for_update_on_startup: false } as const;

/**
 * Arguments for a direct CLI call (plugin, login, app-server), prefixed with
 * the fixed config. These calls belong to no box, so analytics are off too;
 * model turns go through the SDK and follow the box's `codexTelemetry`.
 */
export function codexCliArgs(args: readonly string[]): string[] {
  return ["-c", "analytics.enabled=false", "-c", "feedback.enabled=false", "-c", "check_for_update_on_startup=false", ...args];
}
