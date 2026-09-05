/**
 * Caching and fan-out over the two providers: a short in-process cache for
 * Codex, a ten-minute on-disk cache plus single-flight refresh for Claude.
 * Split out of `agent-quotas.ts`; parsing lives in `agent-quotas-parse.ts`,
 * the live reads in `agent-quotas-requests.ts`.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  AgentQuota,
  ClaudeUsageResult,
  CodexRateLimitResult,
} from "./agent-quotas-parse.js";
import {
  isRecord,
  parseClaudeQuota,
  parseCodexQuota,
} from "./agent-quotas-parse.js";
import {
  requestClaudeUsage,
  requestCodexRateLimits,
} from "./agent-quotas-requests.js";

interface ClaudeCache {
  attemptedAt: string | null;
  error: string | null;
  quota: AgentQuota | null;
}

const CODEX_CACHE_MS = 60_000;
export const CLAUDE_CACHE_MS = 10 * 60_000;
let codexCache: { expiresAt: number; value: AgentQuota } | null = null;
let codexPending: Promise<AgentQuota> | null = null;
const claudePending = new Map<string, Promise<AgentQuota>>();

/** Claude answered, but the account exposes no subscription rate-limit windows. */
class ClaudeNoQuotaWindowsError extends Error {
  constructor() {
    super("Claude returned no subscription quota windows.");
    this.name = "ClaudeNoQuotaWindowsError";
  }
}

/** Claude's windows parsed to nothing this dashboard can display. */
class ClaudeUnusableQuotaWindowsError extends Error {
  constructor() {
    super("Claude returned no usable subscription quota windows.");
    this.name = "ClaudeUnusableQuotaWindowsError";
  }
}

async function collectCodexQuota(now: Date): Promise<AgentQuota> {
  if (codexCache && codexCache.expiresAt > now.getTime())
    return codexCache.value;
  if (codexPending) return await codexPending;
  const fetchedAt = now.toISOString();
  codexPending = requestCodexRateLimits()
    .then((result) => parseCodexQuota(result, fetchedAt))
    .catch((error: unknown) => ({
      provider: "codex" as const,
      status: "unavailable" as const,
      fetchedAt,
      windows: [],
      message: error instanceof Error ? error.message : String(error),
    }))
    .then((value) => {
      codexCache = { expiresAt: now.getTime() + CODEX_CACHE_MS, value };
      return value;
    })
    .finally(() => {
      codexPending = null;
    });
  return await codexPending;
}

async function readClaudeCache(cachePath: string): Promise<ClaudeCache> {
  return await fs
    .readFile(cachePath, "utf8")
    .then((text) => {
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed))
        return { attemptedAt: null, error: null, quota: null };
      const capturedAt =
        typeof parsed.captured_at === "string" &&
        Number.isFinite(new Date(parsed.captured_at).getTime())
          ? parsed.captured_at
          : null;
      return {
        attemptedAt:
          typeof parsed.attempted_at === "string"
            ? parsed.attempted_at
            : capturedAt,
        error: typeof parsed.error === "string" ? parsed.error : null,
        quota: capturedAt ? parseClaudeQuota(parsed, capturedAt) : null,
      };
    })
    .catch(() => ({ attemptedAt: null, error: null, quota: null }));
}

async function writeClaudeCache(
  cachePath: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const tempPath = `${cachePath}.${String(process.pid)}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(payload)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await fs.chmod(tempPath, 0o600);
    await fs.rename(tempPath, cachePath);
  } finally {
    await fs.rm(tempPath, { force: true });
  }
}

async function refreshClaudeQuota(
  cachePath: string,
  options: { fetchedAt: string; request: () => Promise<ClaudeUsageResult> },
): Promise<AgentQuota> {
  const { fetchedAt, request } = options;
  const existing = claudePending.get(cachePath);
  if (existing) return await existing;
  const pending = request()
    .then(async (response) => {
      if (!response.rate_limits_available || response.rate_limits === null)
        throw new ClaudeNoQuotaWindowsError();
      const payload = {
        attempted_at: fetchedAt,
        captured_at: fetchedAt,
        rate_limits: response.rate_limits,
      };
      const quota = parseClaudeQuota(payload, fetchedAt);
      if (quota.status !== "available")
        throw new ClaudeUnusableQuotaWindowsError();
      await writeClaudeCache(cachePath, payload);
      return quota;
    })
    .catch(async (error: unknown) => {
      const previousPayload = await fs
        .readFile(cachePath, "utf8")
        .then((text) => {
          const parsed: unknown = JSON.parse(text);
          return isRecord(parsed) ? parsed : {};
        })
        .catch(() => ({}));
      const message = error instanceof Error ? error.message : String(error);
      await writeClaudeCache(cachePath, {
        ...previousPayload,
        attempted_at: fetchedAt,
        error: message,
      });
      throw error;
    })
    .finally(() => claudePending.delete(cachePath));
  claudePending.set(cachePath, pending);
  return await pending;
}

async function collectClaudeQuota(options: {
  backgroundRefresh: boolean;
  cachePath: string;
  fetchedAt: string;
  now: Date;
  request: () => Promise<ClaudeUsageResult>;
}): Promise<AgentQuota> {
  const cache = await readClaudeCache(options.cachePath);
  const attemptedMs = new Date(cache.attemptedAt ?? "").getTime();
  const attemptAge = options.now.getTime() - attemptedMs;
  const recentAttempt =
    Number.isFinite(attemptedMs) &&
    attemptAge >= 0 &&
    attemptAge < CLAUDE_CACHE_MS;
  if (cache.quota && recentAttempt && cache.error === null)
    return { ...cache.quota, stale: false };
  if (recentAttempt && cache.error !== null) {
    if (cache.quota)
      return { ...cache.quota, stale: true, message: cache.error };
    return {
      provider: "claude",
      status: "unavailable",
      fetchedAt: options.fetchedAt,
      windows: [],
      message: cache.error,
    };
  }

  if (options.backgroundRefresh) {
    void refreshClaudeQuota(options.cachePath, {
      fetchedAt: options.fetchedAt,
      request: options.request,
    }).catch(() => {});
    if (cache.quota) return { ...cache.quota, stale: true };
    return {
      provider: "claude",
      status: "unavailable",
      fetchedAt: options.fetchedAt,
      windows: [],
      message: "Claude quota is refreshing; reload shortly.",
    };
  }

  try {
    return await refreshClaudeQuota(options.cachePath, {
      fetchedAt: options.fetchedAt,
      request: options.request,
    });
  } catch (error) {
    if (cache.quota)
      return {
        ...cache.quota,
        stale: true,
        message: error instanceof Error ? error.message : String(error),
      };
    return {
      provider: "claude",
      status: "unavailable",
      fetchedAt: options.fetchedAt,
      windows: [],
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function collectAgentQuotas(options?: {
  backgroundClaudeRefresh?: boolean;
  claudeRequest?: () => Promise<ClaudeUsageResult>;
  stateDir?: string;
  codexRequest?: () => Promise<CodexRateLimitResult>;
  now?: Date;
}): Promise<AgentQuota[]> {
  const resolved = options ?? {};
  const now = resolved.now ?? new Date();
  const fetchedAt = now.toISOString();
  const stateDir =
    resolved.stateDir ??
    // TODO(env-migration): operational state override belongs in shared env config.
    process.env.BBX_STATE_DIR ??
    path.join(os.homedir(), ".cache/beebox");
  const claudePath = path.join(stateDir, "claude-rate-limits.json");
  const codexRequest = resolved.codexRequest;
  const [claude, codex] = await Promise.all([
    collectClaudeQuota({
      backgroundRefresh: resolved.backgroundClaudeRefresh ?? false,
      cachePath: claudePath,
      fetchedAt,
      now,
      request: resolved.claudeRequest ?? requestClaudeUsage,
    }),
    codexRequest
      ? codexRequest()
          .then((result) => parseCodexQuota(result, fetchedAt))
          .catch((error: unknown) => ({
            provider: "codex" as const,
            status: "unavailable" as const,
            fetchedAt,
            windows: [],
            message: error instanceof Error ? error.message : String(error),
          }))
      : collectCodexQuota(now),
  ]);
  return [claude, codex];
}
