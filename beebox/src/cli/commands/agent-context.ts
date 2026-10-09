/** Context emitted by the Codex plugin for Claude-style @file includes. */

import { Command } from "commander";
import { join } from "node:path";
import { findBoxRoot, requireBoxRoot } from "../../lib/paths/core.js";
import { getBoxShape } from "../../lib/box-shape.js";
import { expandInstructionIncludes } from "../../core/agent-context-includes.js";
import { instructionFilePath } from "../../core/agent-instruction-files.js";

export const agentContextCommand = new Command("agent-context")
  .description("Emit harness-neutral box context")
  .option("--hook", "Emit context for a native harness hook")
  .action(async (opts: { hook?: boolean }) => {
    // A harness hook fires in EVERY session of that harness — dev worktrees,
    // unrelated repos — not only inside a box. Outside a box there is no
    // context to emit and nothing wrong: exit 0 silently. Throwing here
    // surfaced as "SessionStart hook (failed): exited with code 1" on every
    // Codex worktree session (2026-08-29) once the plugin was registered.
    const boxRoot = opts.hook === true ? await findBoxRoot(process.cwd()) : await requireBoxRoot();
    if (boxRoot === null) return;
    await getBoxShape(boxRoot);
    const instructionPath = join(boxRoot, await instructionFilePath(boxRoot, ""));
    const context = await expandInstructionIncludes({ instructionPath, boxRoot });
    if (context !== "") process.stdout.write(`${context}\n`);
  });
