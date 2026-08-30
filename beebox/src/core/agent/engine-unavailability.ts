/**
 * Deferred-recoverable engine failures — recognition and description.
 *
 * A deferred-recoverable failure means the agent engine will not work now but
 * will work later, often at a known time: nothing on the task's side is
 * broken, and retrying before the reset is waste. Recognition is deliberately
 * narrow — a per-provider list of known signals — because a misclassified
 * permanent error would be parked as "recoverable someday" and never fixed.
 * Anything unrecognized keeps the ordinary failure path.
 *
 * Design: docs/plans/deferred-recoverable-agent-failures.md
 */

import type { AgentEngine } from "../box/config.js";

/** The account/provider a box's `agentEngine` runs on. Same values as
 * {@link AgentEngine} today; a distinct alias because unavailability is
 * account-scoped, not box-scoped. */
export type EngineProvider = AgentEngine;

export interface EngineUnavailability {
  provider: EngineProvider;
  /** Extensible union; only add reasons with a recognized, evidence-based signal. */
  reason: "quota-exhausted";
  /** ISO. When the engine is expected to work again. */
  retryAt: string;
  /** Whether `retryAt` came from the provider message or a bounded fallback hold. */
  retryAtSource: "parsed" | "fallback";
  /** ISO. When the condition was recognized. */
  detectedAt: string;
  /** The provider's verbatim message. */
  message: string;
}

/** Bounded hold applied when the provider message carries no parseable reset
 * time: retry hourly rather than parking forever or hammering. */
const FALLBACK_HOLD_MS = 60 * 60 * 1000;
/** A parsed reset further out than this is treated as a misparse. */
const MAX_RETRY_AT_MS = 7 * 24 * 60 * 60 * 1000;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Matches the reset time embedded in the Codex quota message, e.g.
 * "try again at Aug 19th, 2026 11:34 PM" (no timezone — box-local). */
const CODEX_RESET_RE =
  /try again at ([a-z]+) (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})[ ,]+(\d{1,2}):(\d{2})\s*(am|pm)/i;

function parseCodexResetDate(message: string): Date | null {
  const match = CODEX_RESET_RE.exec(message);
  if (match === null) return null;
  const [, monthName, day, year, hour, minute, meridiem] = match;
  const month = MONTHS[(monthName ?? "").slice(0, 3).toLowerCase()];
  if (month === undefined) return null;
  const hour12 = Number(hour) % 12;
  const hour24 = meridiem?.toUpperCase() === "PM" ? hour12 + 12 : hour12;
  return new Date(Number(year), month, Number(day), hour24, Number(minute));
}

/** Matches Claude Code's usage-limit surface, "Claude AI usage limit
 * reached|<unix-epoch-seconds>". Provisional: not yet verified against a live
 * exhausted Claude account (plan, Rollout shape). */
const CLAUDE_EPOCH_RE = /usage limit reached\|(\d{9,12})/i;
const CLAUDE_LIMIT_RE = /usage limit reached/i;

const CODEX_LIMIT_RE = /you've hit your usage limit/i;

function recognizedResetDate(options: {
  provider: EngineProvider;
  message: string;
}): { hit: boolean; resetAt: Date | null } {
  const { provider, message } = options;
  if (provider === "codex") {
    if (!CODEX_LIMIT_RE.test(message)) return { hit: false, resetAt: null };
    return { hit: true, resetAt: parseCodexResetDate(message) };
  }
  const epoch = CLAUDE_EPOCH_RE.exec(message);
  if (epoch !== null) return { hit: true, resetAt: new Date(Number(epoch[1]) * 1000) };
  if (CLAUDE_LIMIT_RE.test(message)) return { hit: true, resetAt: null };
  return { hit: false, resetAt: null };
}

function boundRetryAt(options: {
  resetAt: Date | null;
  now: Date;
}): { retryAt: string; retryAtSource: "parsed" | "fallback" } {
  const { resetAt, now } = options;
  const nowMs = now.getTime();
  if (
    resetAt !== null &&
    !Number.isNaN(resetAt.getTime()) &&
    resetAt.getTime() > nowMs &&
    resetAt.getTime() <= nowMs + MAX_RETRY_AT_MS
  ) {
    return { retryAt: resetAt.toISOString(), retryAtSource: "parsed" };
  }
  return { retryAt: new Date(nowMs + FALLBACK_HOLD_MS).toISOString(), retryAtSource: "fallback" };
}

/**
 * Classify an engine-level error message. Returns the unavailability when the
 * message matches a recognized provider signal, else null. The match runs on
 * the engine's own error text only — never on task output.
 */
export function recognizeEngineUnavailability(options: {
  provider: EngineProvider;
  message: string | null | undefined;
  now: Date;
}): EngineUnavailability | null {
  const { provider, message, now } = options;
  if (message === null || message === undefined || message === "") return null;
  const { hit, resetAt } = recognizedResetDate({ provider, message });
  if (!hit) return null;
  return {
    provider,
    reason: "quota-exhausted",
    ...boundRetryAt({ resetAt, now }),
    detectedAt: now.toISOString(),
    message,
  };
}

const PROVIDER_NAMES: Record<EngineProvider, string> = { codex: "Codex", claude: "Claude" };

/** Human-readable reset time in box-local wall clock, e.g. "Aug 19, 11:34 PM". */
export function formatRetryAt(retryAt: string): string {
  return new Date(retryAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The one human-readable line every string surface shows for this condition —
 * chat, `lastError`, procedure output, logs.
 */
export function describeEngineUnavailability(unavailability: EngineUnavailability): string {
  const name = PROVIDER_NAMES[unavailability.provider];
  return (
    `${name} is out of usage quota until ${formatRetryAt(unavailability.retryAt)} ` +
    `(account-level: affects every box and task using this ${name} account). ` +
    `Provider message: ${unavailability.message}`
  );
}
