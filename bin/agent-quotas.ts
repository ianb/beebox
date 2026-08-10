import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

import type { SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk";

export interface QuotaWindow {
  label: string;
  usedPercent: number;
  resetsAt: string;
  durationMinutes: number | null;
}

export interface AgentQuota {
  provider: "claude" | "codex";
  status: "available" | "unavailable";
  fetchedAt: string;
  windows: QuotaWindow[];
  credits?: { balance: string | null; unlimited: boolean };
  message?: string;
  stale?: boolean;
}

interface CodexWindow {
  usedPercent?: unknown;
  resetsAt?: unknown;
  windowDurationMins?: unknown;
}

interface CodexSnapshot {
  limitName?: unknown;
  primary?: CodexWindow | null;
  secondary?: CodexWindow | null;
  credits?: { balance?: unknown; unlimited?: unknown } | null;
}

interface CodexRateLimitResult {
  rateLimits?: CodexSnapshot | null;
  rateLimitsByLimitId?: Record<string, CodexSnapshot> | null;
}

type ClaudeUsageResult = Pick<
  SDKControlGetUsageResponse,
  "rate_limits" | "rate_limits_available"
>;

interface ClaudeCache {
  attemptedAt: string | null;
  error: string | null;
  quota: AgentQuota | null;
}

const CLAUDE_DURATIONS: Record<string, number> = {
  five_hour: 5 * 60,
  seven_day: 7 * 24 * 60,
  seven_day_oauth_apps: 7 * 24 * 60,
  seven_day_opus: 7 * 24 * 60,
  seven_day_sonnet: 7 * 24 * 60,
};
const CODEX_CACHE_MS = 60_000;
export const CLAUDE_CACHE_MS = 10 * 60_000;
let codexCache: { expiresAt: number; value: AgentQuota } | null = null;
let codexPending: Promise<AgentQuota> | null = null;
const claudePending = new Map<string, Promise<AgentQuota>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codexWindowRecord(value: unknown): CodexWindow | null {
  if (!isRecord(value)) return null;
  return {
    usedPercent: value.usedPercent,
    resetsAt: value.resetsAt,
    windowDurationMins: value.windowDurationMins,
  };
}

function codexSnapshotRecord(value: unknown): CodexSnapshot | null {
  if (!isRecord(value)) return null;
  const credits = isRecord(value.credits)
    ? { balance: value.credits.balance, unlimited: value.credits.unlimited }
    : null;
  return {
    limitName: value.limitName,
    primary: codexWindowRecord(value.primary),
    secondary: codexWindowRecord(value.secondary),
    credits,
  };
}

function codexRateLimitResult(value: unknown): CodexRateLimitResult {
  if (!isRecord(value)) return {};
  const byId = isRecord(value.rateLimitsByLimitId)
    ? Object.fromEntries(
        Object.entries(value.rateLimitsByLimitId).flatMap(([id, snapshot]) => {
          const parsed = codexSnapshotRecord(snapshot);
          return parsed ? [[id, parsed]] : [];
        }),
      )
    : null;
  return {
    rateLimits: codexSnapshotRecord(value.rateLimits),
    rateLimitsByLimitId: byId,
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isoFromUnixSeconds(value: unknown): string | null {
  const seconds = finiteNumber(value);
  if (seconds === null) return null;
  const date = new Date(seconds * 1_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function windowDurationLabel(
  durationMinutes: number | null,
  fallback: string,
): string {
  if (durationMinutes === 300) return "5-hour window";
  if (durationMinutes === 10_080) return "7-day window";
  if (durationMinutes !== null && durationMinutes % (24 * 60) === 0)
    return `${String(durationMinutes / (24 * 60))}-day window`;
  if (durationMinutes !== null && durationMinutes % 60 === 0)
    return `${String(durationMinutes / 60)}-hour window`;
  return fallback;
}

function codexWindow(
  baseLabel: string,
  fallbackLabel: string,
  value: CodexWindow | null | undefined,
): QuotaWindow | null {
  const usedPercent = finiteNumber(value?.usedPercent);
  const resetsAt = isoFromUnixSeconds(value?.resetsAt);
  if (usedPercent === null || resetsAt === null) return null;
  const durationMinutes = finiteNumber(value?.windowDurationMins);
  const durationLabel = windowDurationLabel(durationMinutes, fallbackLabel);
  return {
    label: baseLabel ? `${baseLabel} · ${durationLabel}` : durationLabel,
    usedPercent,
    resetsAt,
    durationMinutes,
  };
}

export function parseCodexQuota(
  result: CodexRateLimitResult,
  fetchedAt = new Date().toISOString(),
): AgentQuota {
  const byId = result.rateLimitsByLimitId ?? {};
  const snapshots =
    Object.keys(byId).length > 0
      ? Object.entries(byId).sort(([left], [right]) =>
          left === "codex"
            ? -1
            : right === "codex"
              ? 1
              : left.localeCompare(right),
        )
      : result.rateLimits
        ? [["codex", result.rateLimits] as const]
        : [];
  if (snapshots.length === 0) {
    return {
      provider: "codex",
      status: "unavailable",
      fetchedAt,
      windows: [],
      message: "Codex returned no rate-limit windows.",
    };
  }
  const windows = snapshots.flatMap(([id, snapshot]) => {
    const name =
      typeof snapshot.limitName === "string" && snapshot.limitName !== "Codex"
        ? snapshot.limitName
        : id === "codex"
          ? ""
          : id;
    return [
      codexWindow(name, "Primary window", snapshot.primary),
      codexWindow(name, "Secondary window", snapshot.secondary),
    ].filter((window): window is QuotaWindow => window !== null);
  });
  const snapshot = byId.codex ?? result.rateLimits ?? snapshots[0]?.[1];
  const credits = snapshot?.credits;
  const balance = credits?.balance;
  return {
    provider: "codex",
    status: windows.length > 0 ? "available" : "unavailable",
    fetchedAt,
    windows,
    ...(credits
      ? {
          credits: {
            balance: typeof balance === "string" ? balance : null,
            unlimited: credits.unlimited === true,
          },
        }
      : {}),
    ...(windows.length === 0
      ? { message: "Codex returned no usable rate-limit windows." }
      : {}),
  };
}

function claudeLabel(key: string): string {
  const labels: Record<string, string> = {
    five_hour: "5-hour window",
    seven_day: "7-day window",
    seven_day_opus: "7-day Opus window",
    seven_day_sonnet: "7-day Sonnet window",
    overage: "Extra usage",
  };
  return labels[key] ?? key.replaceAll("_", " ");
}

export function parseClaudeQuota(
  input: unknown,
  fetchedAt = new Date().toISOString(),
): AgentQuota {
  if (
    typeof input !== "object" ||
    input === null ||
    !("rate_limits" in input)
  ) {
    return {
      provider: "claude",
      status: "unavailable",
      fetchedAt,
      windows: [],
      message: "No Claude quota has been captured from an active session yet.",
    };
  }
  const rateLimits = (input as { rate_limits?: unknown }).rate_limits;
  if (typeof rateLimits !== "object" || rateLimits === null) {
    return {
      provider: "claude",
      status: "unavailable",
      fetchedAt,
      windows: [],
      message: "Claude quota data is unavailable.",
    };
  }
  const rateLimitRecord = rateLimits as Record<string, unknown>;
  const windows = Object.entries(rateLimitRecord).flatMap(([key, raw]) => {
    if (typeof raw !== "object" || raw === null) return [];
    const value = raw as {
      used_percentage?: unknown;
      utilization?: unknown;
      resets_at?: unknown;
    };
    const usedPercent = finiteNumber(
      value.used_percentage ?? value.utilization,
    );
    const resetValue = value.resets_at;
    const resetDate =
      typeof resetValue === "string"
        ? new Date(resetValue)
        : new Date((finiteNumber(resetValue) ?? Number.NaN) * 1_000);
    if (usedPercent === null || Number.isNaN(resetDate.getTime())) return [];
    return [
      {
        label: claudeLabel(key),
        usedPercent,
        resetsAt: resetDate.toISOString(),
        durationMinutes: CLAUDE_DURATIONS[key] ?? null,
      },
    ];
  });
  const modelScoped = Array.isArray(rateLimitRecord.model_scoped)
    ? rateLimitRecord.model_scoped.flatMap((raw: unknown) => {
        if (!isRecord(raw) || typeof raw.display_name !== "string") return [];
        const usedPercent = finiteNumber(raw.utilization);
        const resetDate = new Date(
          typeof raw.resets_at === "string" ? raw.resets_at : Number.NaN,
        );
        if (usedPercent === null || Number.isNaN(resetDate.getTime()))
          return [];
        return [
          {
            label: `${raw.display_name} · 7-day window`,
            usedPercent,
            resetsAt: resetDate.toISOString(),
            durationMinutes: 7 * 24 * 60,
          },
        ];
      })
    : [];
  windows.push(...modelScoped);
  return {
    provider: "claude",
    status: windows.length > 0 ? "available" : "unavailable",
    fetchedAt,
    windows,
    ...(windows.length === 0
      ? { message: "Claude quota data contains no usable windows." }
      : {}),
  };
}

export async function requestClaudeUsage(
  timeoutMs = 15_000,
): Promise<ClaudeUsageResult> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const abortController = new AbortController();
  async function* idleInput(): AsyncGenerator<never, void> {
    await new Promise<void>((resolve) => {
      abortController.signal.addEventListener("abort", () => resolve(), {
        once: true,
      });
    });
  }
  const session = query({
    prompt: idleInput(),
    options: {
      abortController,
      cwd: process.cwd(),
      settingSources: [],
    },
  });
  if (
    typeof session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET !==
    "function"
  ) {
    abortController.abort();
    session.close();
    throw new Error("Installed Claude Agent SDK does not expose quota usage.");
  }
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
    session.close();
  }, timeoutMs);
  try {
    await session.initializationResult();
    return await session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET();
  } catch (error) {
    if (timedOut) throw new Error("Claude quota request timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
    abortController.abort();
    session.close();
  }
}

export function quotaPace(
  window: QuotaWindow,
  now = new Date(),
): {
  expectedPercent: number;
  differencePoints: number;
  onTrack: boolean;
} | null {
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

export async function requestCodexRateLimits(
  timeoutMs = 5_000,
  command = "codex",
): Promise<CodexRateLimitResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = readline.createInterface({ input: child.stdout });
    let stderr = "";
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    const finish = (error?: Error, value?: CodexRateLimitResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.destroy();
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
      killTimer.unref();
      if (error) reject(error);
      else resolve(value ?? {});
    };
    const send = (message: object) => {
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
          if (error) finish(error);
        });
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    };
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdin.on("error", (error) => finish(error));
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => {
      if (killTimer) clearTimeout(killTimer);
      if (!settled)
        finish(
          new Error(stderr.trim() || `Codex app server exited ${String(code)}`),
        );
    });
    lines.on("line", (line) => {
      let message: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!isRecord(parsed)) return;
        message = parsed;
      } catch {
        return;
      }
      if (message.id === 0) {
        if (isRecord(message.error)) {
          finish(
            new Error(
              typeof message.error.message === "string"
                ? message.error.message
                : "Codex initialization failed",
            ),
          );
          return;
        }
        send({ method: "initialized", params: {} });
        send({ method: "account/rateLimits/read", id: 1, params: {} });
      } else if (message.id === 1) {
        if (isRecord(message.error))
          finish(
            new Error(
              typeof message.error.message === "string"
                ? message.error.message
                : "Codex quota request failed",
            ),
          );
        else finish(undefined, codexRateLimitResult(message.result));
      }
    });
    const timer = setTimeout(
      () => finish(new Error("Codex quota request timed out")),
      timeoutMs,
    );
    send({
      method: "initialize",
      id: 0,
      params: {
        clientInfo: {
          name: "callback_box_workstreams",
          title: "Callback Box Workstreams",
          version: "1",
        },
      },
    });
  });
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
  fetchedAt: string,
  request: () => Promise<ClaudeUsageResult>,
): Promise<AgentQuota> {
  const existing = claudePending.get(cachePath);
  if (existing) return await existing;
  const pending = request()
    .then(async (response) => {
      if (!response.rate_limits_available || response.rate_limits === null)
        throw new Error("Claude returned no subscription quota windows.");
      const payload = {
        attempted_at: fetchedAt,
        captured_at: fetchedAt,
        rate_limits: response.rate_limits,
      };
      const quota = parseClaudeQuota(payload, fetchedAt);
      if (quota.status !== "available")
        throw new Error(
          "Claude returned no usable subscription quota windows.",
        );
      await writeClaudeCache(cachePath, payload);
      return quota;
    })
    .catch(async (error: unknown) => {
      const existing = await fs
        .readFile(cachePath, "utf8")
        .then((text) => {
          const parsed: unknown = JSON.parse(text);
          return isRecord(parsed) ? parsed : {};
        })
        .catch(() => ({}));
      const message = error instanceof Error ? error.message : String(error);
      await writeClaudeCache(cachePath, {
        ...existing,
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
    void refreshClaudeQuota(
      options.cachePath,
      options.fetchedAt,
      options.request,
    ).catch(() => undefined);
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
    return await refreshClaudeQuota(
      options.cachePath,
      options.fetchedAt,
      options.request,
    );
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

export async function collectAgentQuotas(
  options: {
    backgroundClaudeRefresh?: boolean;
    claudeRequest?: () => Promise<ClaudeUsageResult>;
    stateDir?: string;
    codexRequest?: () => Promise<CodexRateLimitResult>;
    now?: Date;
  } = {},
): Promise<AgentQuota[]> {
  const now = options.now ?? new Date();
  const fetchedAt = now.toISOString();
  const stateDir =
    options.stateDir ??
    // TODO(env-migration): operational state override belongs in shared env config.
    process.env.CALLBACK_STATE_DIR ??
    path.join(os.homedir(), ".cache/callback-box");
  const claudePath = path.join(stateDir, "claude-rate-limits.json");
  const [claude, codex] = await Promise.all([
    collectClaudeQuota({
      backgroundRefresh: options.backgroundClaudeRefresh ?? false,
      cachePath: claudePath,
      fetchedAt,
      now,
      request: options.claudeRequest ?? requestClaudeUsage,
    }),
    options.codexRequest
      ? options
          .codexRequest()
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.stdout.write(`${JSON.stringify(await collectAgentQuotas())}\n`);
}
