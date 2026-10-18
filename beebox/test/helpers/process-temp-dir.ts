/**
 * A temp directory that lives exactly as long as this test process.
 *
 * The isolation preloads each give every test process its own directory, and
 * a suite is hundreds of processes in several worktrees at once. Without an
 * exit hook each one stays behind: by 2026-10-16 the temp root held ~735,000
 * of them (`bbx-test-auth-`, `-secrets-`, `-origin-`, `-home-`), which made
 * every listing of it take minutes. A killed process still skips this hook;
 * `sweepStaleTempDirs()` in `isolate-user-home.ts` is the backstop for those.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function processTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.on("exit", () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (_e) {
      // Best-effort: a directory a child still holds is left for the sweep.
    }
  });
  return dir;
}
