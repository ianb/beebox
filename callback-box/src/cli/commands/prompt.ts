/**
 * cb prompt - Run Claude Code with a prompt in the agent's environment.
 *
 * Thin wrapper around createAgent() that lets you ask questions or give
 * instructions to the agent in exactly the same context it normally
 * runs (same box root, plugins, rules, agent guide).
 */

import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { createAgent } from "../../core/agent.js";

export const promptCommand = new Command("prompt")
  .description("Run Claude Code with a prompt in the agent environment")
  .argument("<prompt>", "Prompt to send to the agent")
  .option("--max-turns <n>", "Maximum agent turns", "20")
  .option("--model <name>", "Model to use")
  .option("--dry-run", "Show the prompt without running")
  .option("--session-id <id>", "Explicit session ID")
  .option("--resume <id>", "Resume a previous session")
  .action(
    async (
      prompt: string,
      options: {
        maxTurns: string;
        model?: string;
        dryRun?: boolean;
        sessionId?: string;
        resume?: string;
      }
    ) => {
      const boxRoot = await requireBoxRoot();

      // Minimal system prompt — Claude Code auto-loads the box's CLAUDE.md
      // (which @-includes the agent guide) and .claude/rules/
      const systemPrompt = `WORKING DIRECTORY: ${boxRoot}`;

      const sessionId = options.resume ?? options.sessionId;
      const agent = createAgent({
        name: "prompt",
        ...(sessionId && { sessionId }),
        ...(options.resume && { resume: true }),
        onOutput: (text) => process.stdout.write(text),
      });

      const result = await agent.invoke({
        boxRoot,
        systemPrompt,
        prompt,
        maxTurns: parseInt(options.maxTurns, 10),
        ...(options.model && { model: options.model }),
        ...(options.dryRun && { dryRun: true }),
      });

      // Print session ID for follow-up inspection
      console.log(`\n\nSession: ${agent.sessionId}`);
      if (!result.success) {
        // Claude Code's own output (tool calls, messages, any final error) was
        // streamed to stdout via onOutput. Echo the tail to stderr on failure
        // so schedulers — which capture stderr preferentially — see the real
        // reason, not just an uninformative exit code.
        const tail = tailLines(result.output, 30);
        if (tail) {
          console.error("--- claude output (tail) ---");
          console.error(tail);
          console.error("--- end ---");
        }
        if (result.error) console.error(result.error.trimEnd());
        console.error(`cb prompt: FAILED (session ${agent.sessionId}, exit ${result.exitCode})`);
        process.exit(result.exitCode || 1);
      }

      // Exit explicitly so a stray handle (SDK timer, lingering socket)
      // can't keep the process alive past a completed run — schedulers
      // would record that as a timeout failure. Flush stdout first:
      // process.exit() drops data still queued on a pipe.
      await new Promise<void>((resolve) => {
        process.stdout.write("", () => resolve());
      });
      process.exit(0);
    }
  );

function tailLines(text: string, n: number): string {
  const lines = text.split("\n");
  const start = Math.max(0, lines.length - n);
  return lines.slice(start).join("\n").trim();
}
