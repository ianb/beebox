import { appendCodexTurnUsage, codexUsageModel, type CodexTokenUsage } from "../../codex-usage.js";

export async function recordCodexAgentUsage(options: {
  boxRoot: string;
  threadId: string;
  invocationId: string;
  task?: string | undefined;
  model?: string | undefined;
  /** The session's environment, for its `CODEX_HOME`. */
  env?: Record<string, string | undefined> | undefined;
  usage: CodexTokenUsage | null;
  onOutput?: ((text: string) => void) | undefined;
}): Promise<void> {
  if (options.usage === null) {
    options.onOutput?.("Codex did not report token usage for this turn.\n");
    return;
  }
  await appendCodexTurnUsage(options.boxRoot, {
    sessionId: options.threadId,
    turnId: options.invocationId,
    task: options.task ?? "unknown",
    timestamp: new Date().toISOString(),
    model: await codexUsageModel({
      threadId: options.threadId,
      requested: options.model,
      env: options.env,
      warn: (text) => options.onOutput?.(`${text}\n`),
    }),
    usage: options.usage,
  });
}
