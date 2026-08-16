import type { Quota } from "../shared/documents.js";

export interface ClaudeUsageResult {
  rate_limits: unknown;
  rate_limits_available: boolean;
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function codexWindowRecord(value: unknown): CodexWindow | null {
  return isRecord(value) ? {
    usedPercent: value.usedPercent, resetsAt: value.resetsAt, windowDurationMins: value.windowDurationMins,
  } : null;
}

function codexSnapshotRecord(value: unknown): CodexSnapshot | null {
  if (!isRecord(value)) return null;
  return {
    limitName: value.limitName,
    primary: codexWindowRecord(value.primary),
    secondary: codexWindowRecord(value.secondary),
    credits: isRecord(value.credits)
      ? { balance: value.credits.balance, unlimited: value.credits.unlimited }
      : null,
  };
}

export function codexRateLimitResult(value: unknown): CodexRateLimitResult {
  if (!isRecord(value)) return {};
  const byId = isRecord(value.rateLimitsByLimitId)
    ? Object.fromEntries(Object.entries(value.rateLimitsByLimitId).flatMap(([id, snapshot]) => {
        const parsed = codexSnapshotRecord(snapshot);
        return parsed ? [[id, parsed]] : [];
      }))
    : null;
  return { rateLimits: codexSnapshotRecord(value.rateLimits), rateLimitsByLimitId: byId };
}

function durationLabel(minutes: number | null, fallback: string): string {
  if (minutes === 300) return "5-hour window";
  if (minutes === 10_080) return "7-day window";
  if (minutes !== null && minutes % 1_440 === 0) return `${String(minutes / 1_440)}-day window`;
  if (minutes !== null && minutes % 60 === 0) return `${String(minutes / 60)}-hour window`;
  return fallback;
}

function quotaWindow(options: {
  base: string;
  fallback: string;
  value: CodexWindow | null | undefined;
}): Quota["windows"][number] | null {
  const { base, fallback, value } = options;
  const usedPercent = finiteNumber(value?.usedPercent);
  const resetSeconds = finiteNumber(value?.resetsAt);
  if (usedPercent === null || resetSeconds === null) return null;
  const resetsAt = new Date(resetSeconds * 1_000);
  if (Number.isNaN(resetsAt.getTime())) return null;
  const durationMinutes = finiteNumber(value?.windowDurationMins);
  const duration = durationLabel(durationMinutes, fallback);
  return { label: base ? `${base} · ${duration}` : duration, usedPercent, resetsAt: resetsAt.toISOString(), durationMinutes };
}

export function parseCodexQuota(result: CodexRateLimitResult, fetchedAt: string): Quota {
  const byId = result.rateLimitsByLimitId ?? {};
  const snapshots = Object.keys(byId).length > 0
    ? Object.entries(byId).toSorted(([left], [right]) => left === "codex" ? -1 : right === "codex" ? 1 : left.localeCompare(right))
    : result.rateLimits ? [["codex", result.rateLimits] as const] : [];
  const windows = snapshots.flatMap(([id, snapshot]) => {
    const name = typeof snapshot.limitName === "string" && snapshot.limitName !== "Codex"
      ? snapshot.limitName : id === "codex" ? "" : id;
    return [
      quotaWindow({ base: name, fallback: "Primary window", value: snapshot.primary }),
      quotaWindow({ base: name, fallback: "Secondary window", value: snapshot.secondary }),
    ]
      .filter((window) => window !== null);
  });
  const primary = byId.codex ?? result.rateLimits ?? snapshots[0]?.[1];
  return {
    provider: "codex",
    status: windows.length > 0 ? "available" : "unavailable",
    fetchedAt,
    windows,
    ...(primary?.credits ? { credits: {
      balance: typeof primary.credits.balance === "string" ? primary.credits.balance : null,
      unlimited: primary.credits.unlimited === true,
    } } : {}),
    ...(windows.length === 0 ? {
      message: snapshots.length > 0
        ? "Codex returned no usable rate-limit windows."
        : "Codex returned no rate-limit windows.",
    } : {}),
  };
}

const CLAUDE_DURATIONS: Record<string, number> = {
  five_hour: 300, seven_day: 10_080, seven_day_oauth_apps: 10_080,
  seven_day_opus: 10_080, seven_day_sonnet: 10_080,
};

function claudeLabel(key: string): string {
  const labels: Record<string, string> = {
    five_hour: "5-hour window", seven_day: "7-day window", seven_day_opus: "7-day Opus window",
    seven_day_sonnet: "7-day Sonnet window", overage: "Extra usage",
  };
  return labels[key] ?? key.replaceAll("_", " ");
}

export function parseClaudeQuota(input: unknown, fetchedAt: string): Quota {
  if (!isRecord(input) || !isRecord(input.rate_limits)) return {
    provider: "claude", status: "unavailable", fetchedAt, windows: [], message: "Claude quota data is unavailable.",
  };
  const windows = Object.entries(input.rate_limits).flatMap(([key, raw]) => {
    if (!isRecord(raw)) return [];
    const usedPercent = finiteNumber(raw.used_percentage ?? raw.utilization);
    const reset = typeof raw.resets_at === "string" ? new Date(raw.resets_at) : new Date((finiteNumber(raw.resets_at) ?? Number.NaN) * 1_000);
    if (usedPercent === null || Number.isNaN(reset.getTime())) return [];
    return [{ label: claudeLabel(key), usedPercent, resetsAt: reset.toISOString(), durationMinutes: CLAUDE_DURATIONS[key] ?? null }];
  });
  const scoped = Array.isArray(input.rate_limits.model_scoped) ? input.rate_limits.model_scoped.flatMap((raw) => {
    if (!isRecord(raw) || typeof raw.display_name !== "string") return [];
    const usedPercent = finiteNumber(raw.utilization);
    const reset = new Date(typeof raw.resets_at === "string" ? raw.resets_at : Number.NaN);
    return usedPercent === null || Number.isNaN(reset.getTime()) ? [] : [{
      label: `${raw.display_name} · 7-day window`, usedPercent, resetsAt: reset.toISOString(), durationMinutes: 10_080,
    }];
  }) : [];
  windows.push(...scoped);
  return {
    provider: "claude", status: windows.length > 0 ? "available" : "unavailable", fetchedAt, windows,
    ...(windows.length === 0 ? { message: "Claude quota data contains no usable windows." } : {}),
  };
}
