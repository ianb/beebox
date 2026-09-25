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
import { parseGlmQuota, type GlmQuotaResponse } from "./quota-glm.js";
import { readGlmKey, requestGlmQuota } from "./quota-glm-request.js";

const CODEX_CACHE_MS = 60_000;
// The same minute-long cache as Codex: one plain HTTP call, and the panel is
// polled far more often than the numbers move.
const GLM_CACHE_MS = 60_000;
let glmCache: { expiresAt: number; value: Quota } | null = null;
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

/**
 * `null` — and so no GLM card at all — when the key is absent. A machine that
 * never signed up for a coding plan should not be told its quota is
 * "unavailable" forever; that reads as breakage rather than as absence.
 */
async function collectGlm(now: Date, request: (() => Promise<GlmQuotaResponse>) | null): Promise<Quota | null> {
  if (request === null) return null;
  if (glmCache && glmCache.expiresAt > now.getTime()) return glmCache.value;
  const fetchedAt = now.toISOString();
  const value = await request()
    .then((response) => parseGlmQuota(response, fetchedAt))
    .catch((error: unknown): Quota => ({
      provider: "glm", status: "unavailable", fetchedAt, windows: [],
      message: error instanceof Error ? error.message : String(error),
    }));
  glmCache = { expiresAt: now.getTime() + GLM_CACHE_MS, value };
  return value;
}

export interface CollectQuotasOptions {
  backgroundClaudeRefresh?: boolean;
  claudeRequest?: () => Promise<ClaudeUsageResult>;
  stateDir?: string;
  codexRequest?: () => Promise<CodexRateLimitResult>;
  /**
   * Opt-in, unlike the other two: omitting it collects NO GLM quota.
   *
   * Claude and Codex resolve through a local CLI/SDK, so a default that does
   * the real thing costs a caller nothing. GLM is an authenticated call to a
   * third party with the boxholder's key — a test that forgot to stub it would
   * spend real credit against a real account, which is what happened the first
   * time this defaulted to live. `glmQuotaFromEnv()` is the explicit opt-in the
   * service uses.
   */
  glmRequest?: (() => Promise<GlmQuotaResponse>) | null;
  now?: Date;
}

/**
 * The real GLM request, or `null` when this machine has no coding-plan key —
 * in which case no GLM card appears at all, rather than one that reads
 * "unavailable" forever and looks like breakage.
 */
export async function glmQuotaFromEnv(): Promise<(() => Promise<GlmQuotaResponse>) | null> {
  const key = await readGlmKey();
  return key === null ? null : () => requestGlmQuota(key, 10_000);
}

export async function collectAgentQuotas(options: CollectQuotasOptions): Promise<Quota[]> {
  const now = options.now ?? new Date();
  const fetchedAt = now.toISOString();
  const stateDir = options.stateDir ?? process.env.BBX_STATE_DIR ?? path.join(os.homedir(), ".cache/beebox");
  const glmRequest = options.glmRequest ?? null;
  const [claude, codex, glm] = await Promise.all([
    collectClaude({
      background: options.backgroundClaudeRefresh ?? false,
      cachePath: path.join(stateDir, "claude-rate-limits.json"), fetchedAt, now,
      request: options.claudeRequest ?? (() => requestClaudeUsage(15_000)),
    }),
    collectCodex(now, options.codexRequest ?? (() => requestCodexRateLimits(5_000, "codex"))),
    collectGlm(now, glmRequest),
  ]);
  return glm === null ? [claude, codex] : [claude, codex, glm];
}
