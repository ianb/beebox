/**
 * Normalized agent-quota shapes and the pure parsers that produce them from the
 * raw Claude/Codex payloads. Split out of `agent-quotas.ts`; the request and
 * collection halves live in `agent-quotas-requests.ts` and
 * `agent-quotas-collect.ts`.
 */

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

export interface CodexWindow {
  usedPercent?: unknown;
  resetsAt?: unknown;
  windowDurationMins?: unknown;
}

export interface CodexSnapshot {
  limitName?: unknown;
  primary?: CodexWindow | null;
  secondary?: CodexWindow | null;
  credits?: { balance?: unknown; unlimited?: unknown } | null;
}

export interface CodexRateLimitResult {
  rateLimits?: CodexSnapshot | null;
  rateLimitsByLimitId?: Record<string, CodexSnapshot> | null;
}

export type ClaudeUsageResult = Pick<
  SDKControlGetUsageResponse,
  "rate_limits" | "rate_limits_available"
>;

const CLAUDE_DURATIONS: Record<string, number> = {
  five_hour: 5 * 60,
  seven_day: 7 * 24 * 60,
  seven_day_oauth_apps: 7 * 24 * 60,
  seven_day_opus: 7 * 24 * 60,
  seven_day_sonnet: 7 * 24 * 60,
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Any non-null object, arrays included — the exact shape the Claude parser's
 * `typeof x === "object" && x !== null` checks accept, expressed as a guard so
 * no `as` cast is needed to read properties off it.
 */
function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

export function codexRateLimitResult(value: unknown): CodexRateLimitResult {
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
  value: CodexWindow | null | undefined,
  labels: { base: string; fallback: string },
): QuotaWindow | null {
  const usedPercent = finiteNumber(value?.usedPercent);
  const resetsAt = isoFromUnixSeconds(value?.resetsAt);
  if (usedPercent === null || resetsAt === null) return null;
  const durationMinutes = finiteNumber(value?.windowDurationMins);
  const durationLabel = windowDurationLabel(durationMinutes, labels.fallback);
  return {
    label: labels.base ? `${labels.base} · ${durationLabel}` : durationLabel,
    usedPercent,
    resetsAt,
    durationMinutes,
  };
}

export function parseCodexQuota(
  result: CodexRateLimitResult,
  fetchedAtArg?: string,
): AgentQuota {
  const fetchedAt = fetchedAtArg ?? new Date().toISOString();
  const byId = result.rateLimitsByLimitId ?? {};
  const snapshots =
    Object.keys(byId).length > 0
      ? Object.entries(byId).toSorted(([left], [right]) =>
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
      codexWindow(snapshot.primary, { base: name, fallback: "Primary window" }),
      codexWindow(snapshot.secondary, {
        base: name,
        fallback: "Secondary window",
      }),
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
  fetchedAtArg?: string,
): AgentQuota {
  const fetchedAt = fetchedAtArg ?? new Date().toISOString();
  if (!isNonNullObject(input) || !("rate_limits" in input)) {
    return {
      provider: "claude",
      status: "unavailable",
      fetchedAt,
      windows: [],
      message: "No Claude quota has been captured from an active session yet.",
    };
  }
  const rateLimits = input.rate_limits;
  if (!isNonNullObject(rateLimits)) {
    return {
      provider: "claude",
      status: "unavailable",
      fetchedAt,
      windows: [],
      message: "Claude quota data is unavailable.",
    };
  }
  const windows = Object.entries(rateLimits).flatMap(([key, raw]) => {
    if (!isNonNullObject(raw)) return [];
    const usedPercent = finiteNumber(raw.used_percentage ?? raw.utilization);
    const resetValue = raw.resets_at;
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
  const modelScoped = Array.isArray(rateLimits.model_scoped)
    ? rateLimits.model_scoped.flatMap((raw: unknown) => {
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
