/**
 * The box-wide context a landmark chat must carry in its system prompt.
 *
 * A landmark chat runs with `cwd` set to the landmark's directory, so that
 * directory's own instruction file loads natively and gets the agent's closest
 * attention. Claude Code also loads the instruction files above `cwd`, but does
 * not expand their `@` includes, so the box root's `AGENTS.md` would arrive
 * without the agent guide and the briefing it includes. This module expands
 * the root file the way the harness would at the box root and hands back the
 * text to append to the system prompt (measured 2026-10-10:
 * `issues/bugs/2026-10-09-landmark-chats-exclude-box-root-instructions.md`).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expandInstructionIncludes } from "../../agent-context-includes.js";
import { instructionFilePath } from "../../agent-instruction-files.js";
import { errnoCode } from "../../../shared/error-guards.js";

const INCLUDE_LINE = /^@\S+\s*$/gm;

/**
 * The root instruction file's text with its `@` includes expanded, framed as a
 * system-prompt section, or "" when the box has no root instruction file.
 */
export async function buildLandmarkBoxContext(boxRoot: string): Promise<string> {
  const instructionPath = join(boxRoot, await instructionFilePath(boxRoot, ""));
  let body: string;
  try {
    body = await readFile(instructionPath, "utf8");
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return "";
    throw error;
  }
  const included = await expandInstructionIncludes({ instructionPath, boxRoot });
  const text = [body.replace(INCLUDE_LINE, "").trim(), included].filter((part) => part !== "").join("\n\n");
  if (text === "") return "";
  return `\n\nBOX CONTEXT:\nThis chat starts in a landmark directory, below the box root, so the box's root instructions do not load on their own. They follow, with their includes. The landmark directory's own instructions also apply, and take precedence for this chat.\n\n${text}`;
}
