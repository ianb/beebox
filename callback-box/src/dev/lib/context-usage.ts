/**
 * Context-size accounting for knowledge audits.
 *
 * Every assistant turn in a Claude Code session log carries a `usage` block.
 * The real *loaded context* for a turn is the sum of all three input figures —
 * `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` —
 * because with prompt caching the big always-on prefix shows up mostly as
 * `cache_read` after the first turn, so raw `input_tokens` alone badly
 * undercounts. `output_tokens` is generated, not loaded, so it's excluded.
 *
 * The first assistant turn's loaded context ≈ the always-on baseline (system
 * prompt + agent-guide + box CLAUDE.md + tool schemas + the prompt itself).
 * The peak across turns = baseline + whatever tool-reads accumulated answering.
 */

import * as fs from "node:fs";
import * as readline from "node:readline";
import { invariant } from "../../lib/invariant.js";

/** The three input components of one assistant turn's loaded context. */
export interface TurnUsage {
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface ContextStats {
  /** Loaded context of the first assistant turn — the always-on baseline. */
  initialTokens: number;
  /** Max loaded context across all assistant turns. */
  peakTokens: number;
  /** peakTokens − initialTokens: how much answering grew the context. */
  addedTokens: number;
  /** Number of assistant turns (LLM inference responses) carrying usage. */
  turnCount: number;
}

/** Loaded context of a single turn: all three input components summed. */
export function loadedContextTokens(usage: TurnUsage): number {
  return usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
}

/**
 * Reduce per-turn usage into baseline / peak / added / turn-count. Returns
 * null when there are no turns (e.g. an empty or unreadable session).
 */
export function summarizeContextUsage(turns: TurnUsage[]): ContextStats | null {
  if (turns.length === 0) return null;
  const loads = turns.map(loadedContextTokens);
  const [initialTokens] = loads;
  invariant(initialTokens !== undefined, "loads must be non-empty (turns.length checked above)");
  const peakTokens = Math.max(...loads);
  return {
    initialTokens,
    peakTokens,
    addedTokens: peakTokens - initialTokens,
    turnCount: turns.length,
  };
}

/** Pull a TurnUsage from a raw `message.usage` record, or null if absent. */
function parseUsage(usage: unknown): TurnUsage | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === "number" ? v : 0);
  return {
    inputTokens: num(u["input_tokens"]),
    cacheCreationInputTokens: num(u["cache_creation_input_tokens"]),
    cacheReadInputTokens: num(u["cache_read_input_tokens"]),
  };
}

/**
 * Stream a session log and collect the per-turn usage of every real assistant
 * response. Skips SDK meta entries and synthetic (locally-generated) assistant
 * messages, matching the filtering `buildEntry` applies — those don't reflect
 * loaded context.
 */
export async function readTurnUsage(logPath: string): Promise<TurnUsage[]> {
  const fileStream = fs.createReadStream(logPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const turns: TurnUsage[] = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line) as Record<string, unknown>;
    } catch (_e) {
      // Partial/concurrent write — skip the line, not the whole scan.
      continue;
    }
    if (raw["type"] !== "assistant" || raw["isMeta"] === true) continue;
    const message = raw["message"] as Record<string, unknown> | undefined;
    if (!message || message["model"] === "<synthetic>") continue;
    const usage = parseUsage(message["usage"]);
    if (usage) turns.push(usage);
  }
  return turns;
}
