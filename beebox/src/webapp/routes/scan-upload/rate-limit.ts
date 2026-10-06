/**
 * Per-credential rate limit for the scan upload routes.
 *
 * In-memory and per-process on purpose: this bounds a runaway or looping
 * uploader, it is not a security control (the scan token already is one), and a
 * durable counter would buy nothing a restart doesn't reset anyway. 60
 * requests/minute is an order of magnitude above real scanner cadence.
 *
 * WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
 */

/** Requests per credential per window. */
export const SCAN_RATE_LIMIT = 60;

const WINDOW_MS = 60_000;

interface RateWindow {
  startedAt: number;
  count: number;
}

const windows = new Map<string, RateWindow>();

export interface ScanRateDecision {
  allowed: boolean;
  /** Seconds until the current window rolls over — the `Retry-After` value. */
  retryAfterSeconds: number;
}

/**
 * Count one request against `key` (a token name, or the owner's email for a
 * hand-driven request) and say whether it may proceed.
 *
 * Wall-clock, not box time: this is a real-elapsed-seconds budget, so it must
 * not follow a frozen or scenario-shifted clock.
 */
export function consumeScanRateLimit(key: string): ScanRateDecision {
  const now = Date.now();
  // Drop windows that have rolled over, so a long-lived server doesn't retain
  // an entry per credential it has ever seen.
  for (const [existing, window] of windows) {
    if (now - window.startedAt >= WINDOW_MS) windows.delete(existing);
  }
  const current = windows.get(key);
  if (current === undefined) {
    windows.set(key, { startedAt: now, count: 1 });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  current.count += 1;
  if (current.count <= SCAN_RATE_LIMIT) return { allowed: true, retryAfterSeconds: 0 };
  const remainingMs = WINDOW_MS - (now - current.startedAt);
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)) };
}

/** Forget every window. Tests use this so one file's bursts don't leak into the
 *  next; nothing in production calls it. */
export function resetScanRateLimits(): void {
  windows.clear();
}
