/**
 * Crash-safe file replace: write to a temp sibling in the same directory,
 * then rename over the target — a kill mid-write leaves either the old or
 * the new complete file, never a truncated one. Shared by the config
 * writer, the token-file writer, and the launchd plist writer
 * (`config-writer.ts`, `token-file.ts`, `schedule.ts`).
 */

import { randomBytes } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface WriteFileAtomicParams {
  readonly contents: string;
  /** Passed to the temp file's own `open` call, so a restrictive mode
   * (e.g. 0600) applies from the moment the file is created — there is no
   * window where secret-bearing content sits at the broader default mode.
   * Also re-asserted with `chmod` after the write as a second, independent
   * guarantee regardless of umask quirks. */
  readonly mode?: number;
  /** chmod'd on the parent directory after `mkdir`, so a pre-existing
   * directory with looser permissions is still tightened. */
  readonly dirMode?: number;
}

export async function writeFileAtomic(filePath: string, params: WriteFileAtomicParams): Promise<void> {
  const { contents, mode, dirMode } = params;
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  if (dirMode !== undefined) {
    await chmod(dir, dirMode);
  }
  const tmp = join(dir, `.tmp-${randomBytes(6).toString("hex")}`);
  await writeFile(tmp, contents, mode !== undefined ? { mode } : undefined);
  if (mode !== undefined) {
    await chmod(tmp, mode);
  }
  await rename(tmp, filePath);
}
