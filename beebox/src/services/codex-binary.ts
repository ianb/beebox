/** Resolve the one package-pinned Codex executable used by every Bee Box path. */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function codexBinaryPath(): string {
  // This diagnostic test override is intentionally read at the call boundary:
  // tests change it between calls, while validated startup configuration is
  // captured once by the entrypoint environment schemas.
  return process.env.BBX_CODEX_BINARY ?? require.resolve("@openai/codex/bin/codex.js");
}
