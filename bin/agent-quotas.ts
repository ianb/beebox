import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

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

const CLAUDE_DURATIONS: Record<string, number> = {
  five_hour: 5 * 60,
  seven_day: 7 * 24 * 60,
  seven_day_opus: 7 * 24 * 60,
  seven_day_sonnet: 7 * 24 * 60,
};
const CODEX_CACHE_MS = 60_000;
const CLAUDE_STALE_MS = 15 * 60_000;
let codexCache: { expiresAt: number; value: AgentQuota } | null = null;
let codexPending: Promise<AgentQuota> | null = null;

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
  const windows = Object.entries(rateLimits).flatMap(([key, raw]) => {
    if (typeof raw !== "object" || raw === null) return [];
    const value = raw as { used_percentage?: unknown; resets_at?: unknown };
    const usedPercent = finiteNumber(value.used_percentage);
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
      let message: {
        id?: number;
        result?: unknown;
        error?: { message?: string };
      };
      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        return;
      }
      if (message.id === 0) {
        if (message.error) {
          finish(
            new Error(message.error.message ?? "Codex initialization failed"),
          );
          return;
        }
        send({ method: "initialized", params: {} });
        send({ method: "account/rateLimits/read", id: 1, params: {} });
      } else if (message.id === 1) {
        if (message.error)
          finish(
            new Error(message.error.message ?? "Codex quota request failed"),
          );
        else finish(undefined, message.result as CodexRateLimitResult);
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

export async function collectAgentQuotas(
  options: {
    stateDir?: string;
    codexRequest?: () => Promise<CodexRateLimitResult>;
    now?: Date;
  } = {},
): Promise<AgentQuota[]> {
  const now = options.now ?? new Date();
  const fetchedAt = now.toISOString();
  const stateDir =
    options.stateDir ??
    process.env.CALLBACK_STATE_DIR ??
    path.join(os.homedir(), ".cache/callback-box");
  const claudePath = path.join(stateDir, "claude-rate-limits.json");
  const claude = await fs
    .readFile(claudePath, "utf8")
    .then((text) => {
      const cached = JSON.parse(text) as { captured_at?: unknown } & Record<
        string,
        unknown
      >;
      const quota = parseClaudeQuota(
        cached,
        typeof cached.captured_at === "string" ? cached.captured_at : fetchedAt,
      );
      return {
        ...quota,
        stale:
          !Number.isFinite(new Date(quota.fetchedAt).getTime()) ||
          now.getTime() - new Date(quota.fetchedAt).getTime() > CLAUDE_STALE_MS,
      };
    })
    .catch(() => parseClaudeQuota(null, fetchedAt));
  const codex = options.codexRequest
    ? await options
        .codexRequest()
        .then((result) => parseCodexQuota(result, fetchedAt))
        .catch((error: unknown) => ({
          provider: "codex" as const,
          status: "unavailable" as const,
          fetchedAt,
          windows: [],
          message: error instanceof Error ? error.message : String(error),
        }))
    : await collectCodexQuota(now);
  return [claude, codex];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.stdout.write(`${JSON.stringify(await collectAgentQuotas())}\n`);
}
