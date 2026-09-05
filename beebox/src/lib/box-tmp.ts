/**
 * Box-scoped temp directory: `<boxRoot>/_tmp/`.
 *
 * This is the blessed home for ephemeral, box-runtime scratch — uploaded files,
 * capture staging, screenshots, and anything else produced while serving a
 * request for a specific box. It is gitignored and swept after 7 days by
 * `core/housekeeping.ts`, and — the reason it exists — it keeps per-box data out
 * of the shared host `os.tmpdir()`, where multiple boxes on one host would
 * collide on a fixed path and where user content would land outside the box it
 * belongs to.
 *
 * HTTP route handlers (and other box-request code) must use this instead of
 * `os.tmpdir()` — enforced by `no-restricted-properties` in `eslint.config.ts`
 * for `src/webapp/routes|trpc`. CLI/dev tooling that is genuinely host-scoped
 * (build scratch, one-off subprocess IPC) may still use the host temp dir.
 */
import * as fs from "node:fs/promises";
import { getBoxDir } from "./paths.js";

/** Path of the box's swept temp dir (`<boxRoot>/_tmp`). Pure — touches no disk. */
export function boxTmpDir(boxRoot: string): string {
  return getBoxDir(boxRoot, "tmp");
}

/** Ensure `<boxRoot>/_tmp/` exists and return its absolute-under-box path. */
export async function ensureBoxTmpDir(boxRoot: string): Promise<string> {
  const dir = boxTmpDir(boxRoot);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
