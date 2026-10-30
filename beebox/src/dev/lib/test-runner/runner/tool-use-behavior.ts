/** Knowledge-audit behavior from a Claude transcript's tool calls: reads, searches, and commands. */

import type { SessionContentBlock } from "../../../../cli/lib/session.js";
import { type KnownToolName, isKnownTool } from "../../../../shared/known-tools.js";
import { shellCommandConsultsFiles, shellCommandSearches } from "./shell-observation.js";

export interface BehaviorAccumulator {
  filesRead: string[];
  searches: Array<{ tool: string; summary: string }>;
  bashCommands: string[];
  bashRawCommands: string[];
}

interface ToolUseContext {
  block: SessionContentBlock;
  acc: BehaviorAccumulator;
  summary: string;
  name: string;
}

/** Per-tool behavior accumulators, keyed on the shared tool vocabulary. */
const TOOL_USE_CATEGORIZERS: Partial<Record<KnownToolName, (ctx: ToolUseContext) => void>> = {
  Read: ({ summary, acc }) => {
    if (summary) acc.filesRead.push(summary);
  },
  Grep: ({ name, summary, acc }) => acc.searches.push({ tool: name, summary }),
  Glob: ({ name, summary, acc }) => acc.searches.push({ tool: name, summary }),
  // Web lookups count as searches under their own tool name, matching the
  // Codex runner's provider searches (`codex-audit-behavior.ts`).
  WebSearch: ({ name, summary, acc }) => acc.searches.push({ tool: name, summary }),
  WebFetch: ({ name, summary, acc }) => acc.searches.push({ tool: name, summary }),
  Bash: ({ block, summary, acc }) => {
    if (summary) acc.bashCommands.push(summary);
    if (block.input) {
      const cmd = String(block.input.command ?? "");
      if (cmd) {
        acc.bashRawCommands.push(cmd);
        if (shellCommandConsultsFiles(cmd)) acc.filesRead.push(cmd);
        if (shellCommandSearches(cmd)) acc.searches.push({ tool: "Bash", summary: cmd });
      }
    }
  },
} satisfies Partial<Record<KnownToolName, (ctx: ToolUseContext) => void>>;

export function categorizeToolUse(block: SessionContentBlock, acc: BehaviorAccumulator): void {
  const name = block.toolName ?? "";
  const summary = block.inputSummary ?? "";
  if (isKnownTool(name)) {
    TOOL_USE_CATEGORIZERS[name]?.({ block, acc, summary, name });
  }
}
