/**
 * The filesystem roots a box's `file:` hrefs may resolve under: the box's own
 * root (always) plus its declared `externalRoots` (`_config/box.json`), each
 * realpath'd so it compares cleanly against a realpath'd target in
 * `resolveExternalRef`.
 *
 * Shared by the dev-only `GET /api/external` route and the `bbx extfile sync`
 * command, so both agree on exactly which roots are in bounds.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { loadBoxConfig } from "../box/config.js";

/** Expand a leading `~` / `~/` to the home directory; other paths pass through. */
function expandTilde(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Canonicalize a root to its realpath so it compares cleanly against the
 * realpath'd target in `resolveExternalRef` (e.g. macOS `/var` → `/private/var`).
 * A configured root that doesn't exist falls back to its resolved-but-unreal
 * form — it simply won't match anything.
 */
async function resolveRoot(p: string): Promise<string> {
  const abs = path.resolve(expandTilde(p));
  try {
    return await fs.realpath(abs);
  } catch (_e) {
    return abs;
  }
}

/**
 * The roots this box's `file:` hrefs may resolve under: the box's own root
 * (always) plus the box's declared `externalRoots`. Read per call so edits to
 * box.json take effect without a restart (loadBoxConfig is mtime-cached, so
 * this is cheap).
 */
export async function rootsForBox(boxRoot: string): Promise<string[]> {
  const config = await loadBoxConfig(boxRoot);
  return Promise.all([boxRoot, ...(config.externalRoots ?? [])].map(resolveRoot));
}
