import * as fs from "node:fs/promises";

/**
 * Existence probe: true if `absPath` is accessible, false otherwise. Shared by
 * the box-config loader, the maps precheck/finalize passes, and the markdown
 * link-repair rules, which each kept an identical private copy.
 */
export async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch (_e) {
    // access() throwing IS the answer: the path is absent or unreadable, which
    // for an existence probe both mean "not there" — no information to log.
    return false;
  }
}
