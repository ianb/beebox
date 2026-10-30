/**
 * The box guidance a pi run starts with.
 *
 * pi loads the walk-up `AGENTS.md` (or `CLAUDE.md`) and `.agents/skills` on
 * its own. It does not expand `@file` includes, so the host appends them, as
 * for Codex. It does not load an `AGENTS.md` below its working directory; the
 * file tools deliver those (`nested-guidance.ts`), and one line says so.
 */

import { join } from "node:path";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { expandInstructionIncludes } from "../../../agent-context-includes.js";
import { instructionFilePath } from "../../../agent-instruction-files.js";
import { nestedGuidance, type NestedGuidance } from "./nested-guidance.js";

/** Tells the model what a `<nested-agents-md>` block in a tool result is. */
export const NESTED_AGENTS_LINE =
  "A directory's own AGENTS.md arrives in a <nested-agents-md> block the first time read, edit or write touches a file "
  + "there. Follow it, and check an edit you already made against it.";

export interface PiContextOptions {
  boxRoot: string;
  cwd: string;
  agentDir: string;
  systemPrompt: string | undefined;
  /** As `AgentInvokeOptions.loadBoxContext`. False loads no guidance file, skill, include or nested line. */
  loadBoxContext: boolean;
}

/**
 * pi's settings and resource loader for one run, and the nested-guidance
 * state its file tools share (null without box context). Settings are in memory, so
 * a box's `.pi/settings.json` cannot enable packages. No extension loads:
 * pi extensions are code, and here they would run inside the box server.
 * pi's base prompt always applies; no box file replaces it.
 */
export async function piResources(
  options: PiContextOptions,
): Promise<{ settingsManager: SettingsManager; resourceLoader: DefaultResourceLoader; guidance: NestedGuidance | null }> {
  const { boxRoot, cwd, agentDir, loadBoxContext } = options;
  const includesSeen = new Set<string>();
  const included = loadBoxContext
    ? await expandInstructionIncludes({ instructionPath: join(boxRoot, await instructionFilePath(boxRoot, "")), boxRoot, seen: includesSeen })
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
    // A `SYSTEM.md` in `.pi/` or the agent dir would replace pi's base prompt, and a box agent can write either.
    systemPromptOverride: () => {},
    // pi reads an `appendSystemPrompt` entry that names an existing path as that file, so the text goes in through the override.
    appendSystemPrompt: [],
    appendSystemPromptOverride: () => append,
  });
  await resourceLoader.reload();
  const guidance = loadBoxContext
    ? await nestedGuidance({ boxRoot, cwd, preloaded: resourceLoader.getAgentsFiles().agentsFiles.map((file) => file.path), includesSeen })
    : null;
  return { settingsManager, resourceLoader, guidance };
}
