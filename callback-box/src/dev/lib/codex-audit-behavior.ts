/** Adapt Codex's live provider activity into knowledge-audit observations. */

import type { CodexObservedActivity } from "../../core/agent/codex-run.js";
import { shellCommandConsultsFiles, shellCommandSearches } from "./shell-command-observation.js";
import type { AgentBehavior } from "./test-runner.js";

/** Pure normalization boundary for fixture tests and provider parity checks. */
export function codexBehaviorFromActivity(
  activity: CodexObservedActivity[],
  rawResponseText: string,
): AgentBehavior {
  const commands = activity.flatMap((item) => item.type === "command" ? [item.command] : []);
  const providerSearches = activity.flatMap((item) => {
    if (item.type === "search") {
      return [{ tool: item.tool, summary: item.summary }];
    }
    return [];
  });
  const shellSearches = commands
    .filter(shellCommandSearches)
    .map((command) => ({ tool: "Bash", summary: command }));
  const responseText = rawResponseText.trim();
  return {
    // Codex exposes reads through shell commands rather than a dedicated Read
    // tool. Keep only commands that actually invoke a text-reading utility,
    // and normalize editable AGENTS.md mirrors to their canonical CLAUDE.md.
    filesRead: commands
      .filter(shellCommandConsultsFiles)
      .map((command) => command.replaceAll("AGENTS.md", "CLAUDE.md")),
    searches: [...providerSearches, ...shellSearches],
    bashCommands: commands,
    bashRawCommands: commands,
    responseText,
    responseLength: responseText.split(/\s+/).filter(Boolean).length,
    // Codex does not expose Claude-equivalent per-turn context snapshots.
    // transcript-derived initial/peak measurements.
    context: null,
  };
}
