/** Callback-owned usage ledger for Codex turns (native history omits usage). */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { errnoCode, errorMessage } from "../shared/error-guards.js";
import { BOX_DIRS } from "../lib/paths/core.js";
import { codexHomeDir, readCodexRolloutModel } from "../services/codex-rollout-model.js";

/** The ledger's model when neither the rollout nor the request names one. */
const CODEX_UNKNOWN_MODEL = "codex-default";

export const CODEX_USAGE_REL_PATH = `${BOX_DIRS.usage}/codex-turns.jsonl`;

const codexTokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  cacheWriteInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningOutputTokens: z.number().int().nonnegative(),
});

const codexTurnUsageSchema = z.object({
  sessionId: z.string(),
  turnId: z.string(),
  task: z.string(),
  timestamp: z.string(),
  model: z.string(),
  usage: codexTokenUsageSchema,
});

export type CodexTokenUsage = z.infer<typeof codexTokenUsageSchema>;
export type CodexTurnUsage = z.infer<typeof codexTurnUsageSchema>;

class CodexUsageCounterResetError extends Error {
  constructor() {
    super("Codex cumulative usage was smaller than its recorded session total");
    this.name = "CodexUsageCounterResetError";
  }
}

/**
 * The model to record for a completed turn: the one Codex's rollout names for
 * the thread's latest turn, else the requested one, else
 * {@link CODEX_UNKNOWN_MODEL}. A failed lookup goes to `warn` and never stops
 * the row being written.
 */
export async function codexUsageModel(options: {
  threadId: string;
  requested: string | undefined;
  /** The session's environment, for its `CODEX_HOME`. */
  env: Record<string, string | undefined> | undefined;
  warn: (text: string) => void;
}): Promise<string> {
  let reported: string | null = null;
  try {
    reported = await readCodexRolloutModel({ codexHome: codexHomeDir(options.env), threadId: options.threadId });
    if (reported === null) options.warn(`No Codex rollout found for thread ${options.threadId}; its model is unknown.`);
  } catch (error) {
    options.warn(`Could not read the model of Codex thread ${options.threadId}: ${errorMessage(error)}`);
  }
  return reported ?? options.requested ?? CODEX_UNKNOWN_MODEL;
}

/** Append one completed native turn. Callers pass `last`, never cumulative totals. */
export async function appendCodexTurnUsage(boxRoot: string, entry: CodexTurnUsage): Promise<void> {
  const filePath = path.join(boxRoot, CODEX_USAGE_REL_PATH);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
}

export async function readCodexTurnUsage(boxRoot: string): Promise<CodexTurnUsage[]> {
  let content: string;
  try {
    content = await fs.readFile(path.join(boxRoot, CODEX_USAGE_REL_PATH), "utf8");
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return [];
    throw error;
  }
  const entries: CodexTurnUsage[] = [];
  for (const [index, line] of content.split("\n").entries()) {
    if (line.trim() === "") continue;
    try {
      const parsed = codexTurnUsageSchema.safeParse(JSON.parse(line));
      if (parsed.success) entries.push(parsed.data);
      else console.warn(`Codex usage ledger line ${String(index + 1)} has an unsupported shape; skipping it.`);
    } catch (error) {
      // A partial final append must not hide earlier durable usage entries.
      console.warn(`Codex usage ledger line ${String(index + 1)} is malformed; skipping it:`, error);
    }
  }
  return entries;
}

export async function totalCodexSessionUsage(boxRoot: string, sessionId: string): Promise<CodexTokenUsage> {
  const total: CodexTokenUsage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
  for (const entry of await readCodexTurnUsage(boxRoot)) {
    if (entry.sessionId !== sessionId) continue;
    total.inputTokens += entry.usage.inputTokens;
    total.cachedInputTokens += entry.usage.cachedInputTokens;
    total.cacheWriteInputTokens += entry.usage.cacheWriteInputTokens;
    total.outputTokens += entry.usage.outputTokens;
    total.reasoningOutputTokens += entry.usage.reasoningOutputTokens;
  }
  return total;
}

/** The SDK reports thread-cumulative usage; the ledger stores one turn at a time. */
export function codexUsageDelta(current: CodexTokenUsage, previous: CodexTokenUsage): CodexTokenUsage {
  if (
    current.inputTokens < previous.inputTokens ||
    current.cachedInputTokens < previous.cachedInputTokens ||
    current.cacheWriteInputTokens < previous.cacheWriteInputTokens ||
    current.outputTokens < previous.outputTokens ||
    current.reasoningOutputTokens < previous.reasoningOutputTokens
  ) {
    throw new CodexUsageCounterResetError();
  }
  return {
    inputTokens: current.inputTokens - previous.inputTokens,
    cachedInputTokens: current.cachedInputTokens - previous.cachedInputTokens,
    cacheWriteInputTokens: current.cacheWriteInputTokens - previous.cacheWriteInputTokens,
    outputTokens: current.outputTokens - previous.outputTokens,
    reasoningOutputTokens: current.reasoningOutputTokens - previous.reasoningOutputTokens,
  };
}
