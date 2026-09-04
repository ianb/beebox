/**
 * Secret-custody health checks.
 *
 * Split out of `health.ts` for its line budget; the file is the natural home
 * for the rest of the custody surface as it lands (store readability, dangling
 * grants — `docs/plans/secret-custody.md`).
 */

import * as fs from "node:fs/promises";
import { getBoxDir } from "../../../lib/paths.js";
import type { HealthCheck } from "./health.js";

/**
 * Flag any `_config/connectors/*.secret.json` left in the box tree.
 *
 * Every reader now prefers the machine store and keeps its file arm only for
 * the transition window (`docs/plans/secret-custody.md`, Track 3), so a
 * surviving file is a live credential sitting in the agent's own working
 * directory — the exact placement custody exists to remove. Non-fatal: the
 * box works, it is just still exposed, so this is a warning naming the files.
 */
export async function legacySecretFilesCheck(boxRoot: string): Promise<HealthCheck> {
  const dir = getBoxDir(boxRoot, "connectors");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (_e) {
    // No connectors directory at all — the healthy end state.
    entries = [];
  }
  const stray = entries.filter((name) => name.endsWith(".secret.json")).toSorted();
  return {
    name: "legacy-secret-files",
    ok: stray.length === 0,
    message:
      stray.length === 0
        ? "No legacy secret files in the box tree"
        : `Legacy secret file${stray.length === 1 ? "" : "s"} — migrate to the machine store and delete: ` +
          stray.map((name) => `_config/connectors/${name}`).join(", "),
    severity: "warning",
  };
}
