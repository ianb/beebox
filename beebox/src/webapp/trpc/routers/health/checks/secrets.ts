/**
 * Secret-custody health checks.
 *
 * Split out of `health.ts` for its line budget; the file is the natural home
 * for the rest of the custody surface as it lands (store readability, dangling
 * grants — `docs/implemented-plans/secret-custody.md`).
 */

import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import { centralTokenPath } from "../../../../../google/token-store.js";
import { getBoxDir } from "../../../../../lib/paths/core.js";
import type { HealthCheck } from "../router.js";

/**
 * Flag any `_config/connectors/*.secret.json` left in the box tree.
 *
 * Every reader now prefers the machine store and keeps its file arm only for
 * the transition window (`docs/implemented-plans/secret-custody.md`, Track 3), so a
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
  // Google's OAuth tokens never go in the store (the box rewrites them), so
  // that file moves to the token path outside the tree instead of being deleted.
  const keys = stray.filter((name) => name !== "google.secret.json");
  const parts: string[] = [];
  if (keys.length > 0) {
    parts.push(`Legacy secret file${keys.length === 1 ? "" : "s"} — migrate to the machine store and delete: ` +
      keys.map((name) => `_config/connectors/${name}`).join(", "));
  }
  if (keys.length !== stray.length) {
    const central = centralTokenPath();
    if (central === null) {
      parts.push("Google token in the box tree (_config/connectors/google.secret.json) — it is this box's live grant; set BBX_GOOGLE_TOKENS_FILE to move it out of the tree, and do not delete it");
    } else if (existsSync(central)) {
      // The first write there started from the in-tree record, so it holds the grant.
      parts.push(`Google token copy in the box tree — ${central} already holds the grant; delete _config/connectors/google.secret.json`);
    } else {
      parts.push(`Google token in the box tree — copy _config/connectors/google.secret.json to ${central} (as the box's user), then delete the in-tree file`);
    }
  }
  return {
    name: "legacy-secret-files",
    ok: stray.length === 0,
    message: stray.length === 0 ? "No legacy secret files in the box tree" : parts.join(". "),
    severity: "warning",
  };
}
