import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Quota } from "../shared/documents.js";
import {
  isRecord,
  parseClaudeQuota,
  parseCodexQuota,
  type ClaudeUsageResult,
  type CodexRateLimitResult,
} from "./quota-parse.js";
import { requestClaudeUsage, requestCodexRateLimits } from "./quota-requests.js";

const CODEX_CACHE_MS = 60_000;
export const CLAUDE_CACHE_MS = 10 * 60_000;
let codexCache: { expiresAt: number; value: Quota } | null = null;
let codexPending: Promise<Quota> | null = null;
const claudePending = new Map<string, Promise<Quota>>();

function refreshError(message: string): QuotaRefreshError {
  return new QuotaRefreshError(message);
}

interface ClaudeCache {
  attemptedAt: string | null;
  error: string | null;
  quota: Quota | null;
}

async function collectCodex(now: Date, request: () => Promise<CodexRateLimitResult>): Promise<Quota> {
  if (codexCache && codexCache.expiresAt > now.getTime()) return codexCache.value;
  if (codexPending) return codexPending;
  const fetchedAt = now.toISOString();
  codexPending = request().then((result) => parseCodexQuota(result, fetchedAt)).catch((error: unknown) => ({
    provider: "codex" as const, status: "unavailable" as const, fetchedAt, windows: [],
    message: error instanceof Error ? error.message : String(error),
  })).then((value) => {
    codexCache = { expiresAt: now.getTime() + CODEX_CACHE_MS, value };
    return value;
  }).finally(() => { codexPending = null; });
  return codexPending;
}

async function readClaudeCache(cachePath: string): Promise<ClaudeCache> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(cachePath, "utf8"));
    if (!isRecord(parsed)) return { attemptedAt: null, error: null, quota: null };
    const capturedAt = typeof parsed.captured_at === "string" && Number.isFinite(new Date(parsed.captured_at).getTime())
      ? parsed.captured_at : null;
    return {
      attemptedAt: typeof parsed.attempted_at === "string" ? parsed.attempted_at : capturedAt,
      error: typeof parsed.error === "string" ? parsed.error : null,
      quota: capturedAt ? parseClaudeQuota(parsed, capturedAt) : null,
    };
  } catch (_error) {
    return { attemptedAt: null, error: null, quota: null };
  }
}

async function writeClaudeCache(cachePath: string, payload: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const temporary = `${cachePath}.${String(process.pid)}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(payload)}\n`, { flag: "wx", mode: 0o600 });
    await fs.chmod(temporary, 0o600);
    await fs.rename(temporary, cachePath);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function refreshClaude(options: {
  cachePath: string;
  fetchedAt: string;
  request: () => Promise<ClaudeUsageResult>;
}): Promise<Quota> {
  const existing = claudePending.get(options.cachePath);
  if (existing) return existing;
  const pending = options.request().then(async (response) => {
    if (!response.rate_limits_available || response.rate_limits === null) {
      throw refreshError("Claude returned no subscription quota windows.");
    }
    const payload = { attempted_at: options.fetchedAt, captured_at: options.fetchedAt, rate_limits: response.rate_limits };
    const quota = parseClaudeQuota(payload, options.fetchedAt);
    if (quota.status !== "available") {
      throw refreshError("Claude returned no usable subscription quota windows.");
    }
    await writeClaudeCache(options.cachePath, payload);
    return quota;
  }).catch(async (error: unknown) => {
    let existingPayload: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(options.cachePath, "utf8"));
      if (isRecord(parsed)) existingPayload = parsed;
    } catch (_readError) {
      // There is no earlier snapshot to preserve.
    }
    await writeClaudeCache(options.cachePath, {
      ...existingPayload, attempted_at: options.fetchedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }).finally(() => claudePending.delete(options.cachePath));
  claudePending.set(options.cachePath, pending);
  return pending;
}

class QuotaRefreshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaRefreshError";
  }
}

async function collectClaude(options: {
  background: boolean;
  cachePath: string;
  fetchedAt: string;
  now: Date;
  request: () => Promise<ClaudeUsageResult>;
}): Promise<Quota> {
  const cache = await readClaudeCache(options.cachePath);
  const attemptedMs = new Date(cache.attemptedAt ?? "").getTime();
  const age = options.now.getTime() - attemptedMs;
  const recent = Number.isFinite(attemptedMs) && age >= 0 && age < CLAUDE_CACHE_MS;
  if (cache.quota && recent && cache.error === null) return { ...cache.quota, stale: false };
  if (recent && cache.error !== null) return cache.quota
    ? { ...cache.quota, stale: true, message: cache.error }
    : { provider: "claude", status: "unavailable", fetchedAt: options.fetchedAt, windows: [], message: cache.error };
  if (options.background) {
    // refreshClaude persists any failure in the cache for the next request.
    void refreshClaude(options).catch(() => {});
    return cache.quota ? { ...cache.quota, stale: true } : {
      provider: "claude", status: "unavailable", fetchedAt: options.fetchedAt, windows: [],
      message: "Claude quota is refreshing; reload shortly.",
    };
  }
  try {
    return await refreshClaude(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return cache.quota ? { ...cache.quota, stale: true, message } : {
      provider: "claude", status: "unavailable", fetchedAt: options.fetchedAt, windows: [], message,
    };
  }
}

export interface CollectQuotasOptions {
  backgroundClaudeRefresh?: boolean;
  claudeRequest?: () => Promise<ClaudeUsageResult>;
  stateDir?: string;
  codexRequest?: () => Promise<CodexRateLimitResult>;
  now?: Date;
}

export async function collectAgentQuotas(options: CollectQuotasOptions): Promise<Quota[]> {
  const now = options.now ?? new Date();
  const fetchedAt = now.toISOString();
  const stateDir = options.stateDir ?? process.env.BBX_STATE_DIR ?? path.join(os.homedir(), ".cache/beebox");
  const [claude, codex] = await Promise.all([
    collectClaude({
      background: options.backgroundClaudeRefresh ?? false,
      cachePath: path.join(stateDir, "claude-rate-limits.json"), fetchedAt, now,
      request: options.claudeRequest ?? (() => requestClaudeUsage(15_000)),
    }),
    collectCodex(now, options.codexRequest ?? (() => requestCodexRateLimits(5_000, "codex"))),
  ]);
  return [claude, codex];
}
