import { fmt } from "../../lib/format.js";
import { appendCodexTurnUsage, type CodexTokenUsage } from "../codex-usage.js";

export async function recordCodexAgentUsage(options: {
  boxRoot: string;
  threadId: string;
  invocationId: string;
  task?: string | undefined;
  model?: string | undefined;
  usage: CodexTokenUsage | null;
  onOutput?: ((text: string) => void) | undefined;
}): Promise<void> {
  if (options.usage === null) {
    options.onOutput?.(`${fmt.warn("Codex did not report token usage for this turn.")}\n`);
    return;
  }
  await appendCodexTurnUsage(options.boxRoot, {
    sessionId: options.threadId,
    turnId: options.invocationId,
    task: options.task ?? "unknown",
    timestamp: new Date().toISOString(),
    model: options.model ?? "codex-default",
    usage: options.usage,
  });
}
