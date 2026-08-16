/** Context emitted by the Codex plugin for Claude-style @file includes. */

import { Command } from "commander";
import { join } from "node:path";
import { requireBoxRoot } from "../../lib/paths.js";
import { getBoxShape } from "../../lib/box-shape.js";
import { expandClaudeIncludes } from "../../core/agent-context-includes.js";

export { expandClaudeIncludes } from "../../core/agent-context-includes.js";

export const agentContextCommand = new Command("agent-context")
  .description("Emit harness-neutral box context")
  .option("--hook", "Emit context for a native harness hook")
  .action(async () => {
    const boxRoot = await requireBoxRoot();
    const { packageRoot } = await getBoxShape(boxRoot);
    const context = await expandClaudeIncludes({ claudePath: join(boxRoot, "CLAUDE.md"), packageRoot });
    if (context !== "") process.stdout.write(`${context}\n`);
  });
