/** Install the generic card-theme tour into an isolated box without clobbering edits. */
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export interface InstallResult {
  copied: string[];
  skipped: string[];
  conflicts: string[];
}

const SOURCE = path.resolve(import.meta.dirname, "../test/fixtures/theme-tour");

async function filesUnder(root: string, relative?: string): Promise<string[]> {
  const current = relative ?? "";
  const entries = await readdir(path.join(root, current), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(root, child)));
    else files.push(child);
  }
  return files;
}

export async function installThemeTour(boxRoot: string, sourceRoot?: string): Promise<InstallResult> {
  const result: InstallResult = { copied: [], skipped: [], conflicts: [] };
  const destinationRoot = path.join(boxRoot, "_content", "theme-tour");
  await mkdir(destinationRoot, { recursive: true });
  const effectiveSource = sourceRoot ?? SOURCE;
  for (const relative of await filesUnder(effectiveSource)) {
    const source = path.join(effectiveSource, relative);
    const destination = path.join(destinationRoot, relative);
    try {
      const existing = await readFile(destination);
      const incoming = await readFile(source);
      if (existing.equals(incoming)) result.skipped.push(relative);
      else result.conflicts.push(relative);
    } catch (error) {
      const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
      if (code !== "ENOENT") throw error;
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(source, destination);
      result.copied.push(relative);
    }
  }
  return result;
}

async function main(boxRoot: string | undefined): Promise<void> {
  if (boxRoot === undefined) {
    console.error("Usage: install-theme-tour.ts <box-root>");
    process.exitCode = 2;
    return;
  }
  const result = await installThemeTour(boxRoot);
  for (const file of result.conflicts) console.error(`conflict ${file}`);
  if (result.conflicts.length > 0) process.exitCode = 2;
}

if (import.meta.filename === process.argv[1]) await main(process.argv[2]);
