/**
 * Normalized Claude/Codex account quota windows for the owner dashboard and
 * `bin/workstreams quotas`. This module is the public surface; the
 * implementation is split across three siblings so each stays readable:
 * `agent-quotas-parse.ts` (shapes + pure parsers), `agent-quotas-requests.ts`
 * (the live SDK and app-server reads), `agent-quotas-collect.ts` (caching and
 * fan-out).
 */

import { pathToFileURL } from "node:url";

import { collectAgentQuotas } from "./agent-quotas-collect.js";
import type { QuotaWindow } from "./agent-quotas-parse.js";

export type {
  AgentQuota,
  ClaudeUsageResult,
  CodexRateLimitResult,
  QuotaWindow,
} from "./agent-quotas-parse.js";
export { parseClaudeQuota, parseCodexQuota } from "./agent-quotas-parse.js";
export {
  requestClaudeUsage,
  requestCodexRateLimits,
} from "./agent-quotas-requests.js";
export { CLAUDE_CACHE_MS, collectAgentQuotas } from "./agent-quotas-collect.js";

export function quotaPace(
  window: QuotaWindow,
  nowArg?: Date,
): {
  expectedPercent: number;
  differencePoints: number;
  onTrack: boolean;
} | null {
  const now = nowArg ?? new Date();
  if (window.durationMinutes === null || window.durationMinutes <= 0)
    return null;
  const resetMs = new Date(window.resetsAt).getTime();
  if (Number.isNaN(resetMs)) return null;
  const durationMs = window.durationMinutes * 60_000;
  const elapsed = Math.min(
    1,
    Math.max(0, (now.getTime() - (resetMs - durationMs)) / durationMs),
  );
  const expectedPercent = elapsed * 100;
  const differencePoints = expectedPercent - window.usedPercent;
  return { expectedPercent, differencePoints, onTrack: differencePoints >= 0 };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.stdout.write(`${JSON.stringify(await collectAgentQuotas())}\n`);
}
