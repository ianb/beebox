/** Callback-owned usage ledger for Codex turns (native history omits usage). */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { errnoCode } from "../lib/error-guards.js";

export const CODEX_USAGE_REL_PATH = "store/usage/codex-turns.jsonl";

export const codexTokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  cacheWriteInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningOutputTokens: z.number().int().nonnegative(),
});

export const codexTurnUsageSchema = z.object({
  sessionId: z.string(),
  turnId: z.string(),
  task: z.string(),
  timestamp: z.string(),
  model: z.string(),
  usage: codexTokenUsageSchema,
});

export type CodexTokenUsage = z.infer<typeof codexTokenUsageSchema>;
export type CodexTurnUsage = z.infer<typeof codexTurnUsageSchema>;

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
  for (const line of content.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = codexTurnUsageSchema.safeParse(JSON.parse(line));
      if (parsed.success) entries.push(parsed.data);
    } catch (_error) {
      // A partial final append must not hide earlier durable usage entries.
    }
  }
  return entries;
}
