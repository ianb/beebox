/**
 * The box guidance a pi run starts with.
 *
 * pi loads the walk-up `AGENTS.md` (or `CLAUDE.md`) and `.agents/skills` on
 * its own. It does not expand `@file` includes and does not load an
 * `AGENTS.md` below its working directory, so the host appends the expanded
 * includes, as for Codex, and one instruction to read nested files.
 */

import { join } from "node:path";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { expandInstructionIncludes } from "../../agent-context-includes.js";
import { instructionFilePath } from "../../agent-instruction-files.js";

/** pi has no harness rule for scoped guidance files; Codex's built-in prompt has one, pi's does not. */
export const NESTED_AGENTS_LINE =
  "Directories below the box root may contain their own AGENTS.md. Before you read or change files in a directory, "
  + "read the AGENTS.md files on the path from the box root to it and follow them.";

export interface PiContextOptions {
  boxRoot: string;
  cwd: string;
  agentDir: string;
  systemPrompt: string | undefined;
  /** As `AgentInvokeOptions.loadBoxContext`. False loads no guidance file, skill, include or nested line. */
  loadBoxContext: boolean;
}

/**
 * pi's settings and resource loader for one run. Settings are in memory, so
 * a box's `.pi/settings.json` cannot enable packages. No extension loads:
 * pi extensions are code, and here they would run inside the box server.
 */
export async function piResources(
  options: PiContextOptions,
): Promise<{ settingsManager: SettingsManager; resourceLoader: DefaultResourceLoader }> {
  const { boxRoot, cwd, agentDir, loadBoxContext } = options;
  const included = loadBoxContext
    ? await expandInstructionIncludes({ instructionPath: join(boxRoot, await instructionFilePath(boxRoot, "")), boxRoot })
    : "";
  const append = [options.systemPrompt ?? "", included, loadBoxContext ? NESTED_AGENTS_LINE : ""].filter((part) => part !== "");
  const settingsManager = SettingsManager.inMemory();
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noContextFiles: !loadBoxContext,
    noSkills: !loadBoxContext,
    appendSystemPrompt: append,
  });
  await resourceLoader.reload();
  return { settingsManager, resourceLoader };
}
