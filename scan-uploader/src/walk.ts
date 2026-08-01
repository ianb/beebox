/** Non-recursive folder listing: real files only, dotfiles and the `imported/`
 * archive subdirectory excluded (directories are excluded outright, since
 * `imported/` is the only one ScanSnap folders ever contain). */

import { readdir } from "node:fs/promises";
import { join } from "node:path";

export async function listCandidateFiles(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith(".")) continue;
    files.push(join(folder, entry.name));
  }
  return files;
}
