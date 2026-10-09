/**
 * Which folder instruction files apply to a new card.
 *
 * Box agents enter folders through Bash (`ls`, `bbx create`, `cat > file`), and
 * Bash never triggers nested instruction loading. `bbx create` is where they
 * enter the folder, so it names the files and lets the agent decide whether to
 * read them. The root file is always loaded and is not named.
 */

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../shared/error-guards.js";
import { AGENT_INSTRUCTION_FILES } from "./agent-instruction-files.js";

/** True when every non-blank line is an `@` include (a map-only stub). */
function isIncludeOnly(content: string): boolean {
  const lines = content.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  return lines.every((l) => l.startsWith("@"));
}

async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (err) {
    if (errnoCode(err) === "ENOENT") return null;
    throw err;
  }
}

/**
 * One note per instruction file in the card's directory and its ancestors
 * below `boxRoot`, nearest directory first. `cardPath` is box-relative or
 * absolute. Files holding only `@` includes are skipped.
 */
export async function folderInstructionNotes(boxRoot: string, cardPath: string): Promise<string[]> {
  const root = path.resolve(boxRoot);
  const notes: string[] = [];
  let dir = path.dirname(path.resolve(root, cardPath));
  while (dir !== root && dir.startsWith(root + path.sep)) {
    for (const name of AGENT_INSTRUCTION_FILES) {
      const content = await readIfPresent(path.join(dir, name));
      if (content === null || isIncludeOnly(content)) continue;
      const rel = path.relative(root, path.join(dir, name));
      notes.push(`Folder instructions: ${rel}. Read it before filling in this card.`);
    }
    dir = path.dirname(dir);
  }
  return notes;
}
