/**
 * The box-wide context a landmark chat must carry in its system prompt.
 *
 * A landmark chat runs with `cwd` set to the landmark's directory, so that
 * directory's own instruction file loads natively and gets the agent's closest
 * attention. Claude Code also loads the box root's instruction file from there,
 * but does not expand its `@` includes, so the agent guide and the briefing
 * would be missing. This module expands those includes the way the harness
 * would at the box root, for the system prompt (measured 2026-10-10:
 * `issues/bugs/2026-10-09-landmark-chats-exclude-box-root-instructions.md`).
 */

import { join } from "node:path";
import { expandInstructionIncludes } from "../../agent-context-includes.js";
import { instructionFilePath } from "../../agent-instruction-files.js";

/**
 * The root instruction file's `@` includes, expanded and framed as a
 * system-prompt section, or "" when there are none. Throws on an include that
 * escapes the box (`expandInstructionIncludes`); the caller decides whether a
 * chat starts without it.
 */
export async function buildLandmarkBoxContext(boxRoot: string): Promise<string> {
  const instructionPath = join(boxRoot, await instructionFilePath(boxRoot, ""));
  const included = await expandInstructionIncludes({ instructionPath, boxRoot });
  if (included === "") return "";
  return `\n\nBOX CONTEXT:\nThis chat starts in a landmark directory, below the box root. The box root's instruction file loads, but its includes do not; they follow. The landmark directory's own instructions also apply, and take precedence for this chat.\n\n${included}`;
}
