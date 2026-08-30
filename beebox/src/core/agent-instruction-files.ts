/**
 * The two filenames a harness reads box instructions from.
 *
 * `CLAUDE.md` is the authored file. `AGENTS.md` is a symlink to it, planted
 * beside every `CLAUDE.md` by `agent-context-mirrors.ts` so Codex finds the
 * same content under the name it looks for. The two are not symmetric: code
 * that *writes* or *expands* instructions works on `CLAUDE.md` alone and can
 * keep saying so literally.
 *
 * These constants exist for the other case — code that has to RECOGNIZE either
 * name, because a directory listing shows both. Those sites are easy to write
 * as a bare `=== "CLAUDE.md"` that silently ignores the mirror, which is how
 * the map precheck ended up demanding every MAP list a symlink to the file it
 * excludes on the line above.
 */

import * as path from "node:path";

/** The authored instruction file. `AGENTS.md` is a symlink to this. */
export const CLAUDE_MD = "CLAUDE.md";

/** The Codex-facing mirror name. Always a symlink to the sibling CLAUDE.md. */
export const AGENTS_MD = "AGENTS.md";

/** Both names, for membership tests over directory entries. */
export const AGENT_INSTRUCTION_FILES: readonly string[] = [CLAUDE_MD, AGENTS_MD];

/** Either harness's instruction file — instructions, not linkable content. */
export function isAgentInstructionsFile(filePath: string): boolean {
  return AGENT_INSTRUCTION_FILES.includes(path.basename(filePath));
}
