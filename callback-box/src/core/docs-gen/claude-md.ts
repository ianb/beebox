/**
 * CLAUDE.md @-include management for doc generation.
 *
 * Keeps the box's CLAUDE.md pointed at the generated agent guide and any
 * compiled briefing files, without ever overwriting hand-edited content.
 * Split out of generate-docs.ts as a self-contained sub-feature.
 */

import { join } from "node:path";
import { writeFile, readFile } from "node:fs/promises";
import { AGENT_GUIDE_FILE } from "./shared.js";
import { generateAgentContextMirrors } from "../agent-context-mirrors.js";

export async function ensureAgentContext(boxRoot: string, briefingPaths: string[]): Promise<void> {
  await ensureClaudeMdIncludes(boxRoot, briefingPaths);
  await generateAgentContextMirrors(boxRoot);
}

/**
 * Ensure CLAUDE.md has the @-include for the agent guide and any compiled briefings.
 *
 * If CLAUDE.md doesn't exist, create it with the includes.
 * Adds missing includes and removes stale briefing includes.
 * Never overwrite hand-edited content.
 */
export async function ensureClaudeMdIncludes(boxRoot: string, briefingPaths: string[]): Promise<void> {
  const claudePath = join(boxRoot, "CLAUDE.md");
  const includeLine = `@.callback-box/${AGENT_GUIDE_FILE}`;

  // All lines that should be @-included (in order)
  const requiredIncludes = [
    includeLine,
    ...briefingPaths.map((p) => `@${p}`),
  ];

  let content: string;
  try {
    content = await readFile(claudePath, "utf-8");
  } catch (_e) {
    // No CLAUDE.md — create one with all includes. Absence is the normal
    // first-run trigger; the subsequent writeFile would resurface any real
    // I/O problem (e.g. permissions) rather than silently masking it.
    const seed = [
      ...requiredIncludes,
      "",
    ].join("\n");
    await writeFile(claudePath, seed);
    return;
  }

  const lines = content.split("\n");
  let changed = false;

  // Add any missing required includes at the top
  for (const include of requiredIncludes) {
    if (!content.includes(include)) {
      // Find where to insert — after the last existing @-include at the top, or at position 0
      let insertAt = 0;
      for (const [idx, line] of lines.entries()) {
        if (line.startsWith("@")) {
          insertAt = idx + 1;
        } else if (line.trim() !== "") {
          break;
        }
      }
      lines.splice(insertAt, 0, include);
      changed = true;
    }
  }

  // Remove stale briefing @-includes (briefing .md files that no longer exist)
  const beforeLength = lines.length;
  const filtered = lines.filter((line) => {
    if (line.startsWith("@") && line.endsWith(".md") && line !== includeLine) {
      if (line.includes("briefing") && !requiredIncludes.includes(line)) {
        return false;
      }
    }
    return true;
  });
  if (filtered.length !== beforeLength) {
    lines.length = 0;
    lines.push(...filtered);
    changed = true;
  }

  if (changed) {
    await writeFile(claudePath, lines.join("\n"));
  }
}
