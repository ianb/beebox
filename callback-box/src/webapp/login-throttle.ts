/**
 * Login throttle — a pure, in-memory decision core for `POST /auth/login` and
 * `POST /auth/setup`.
 *
 * No HTTP rate limiting existed anywhere in the tree, so this is hand-rolled
 * (no new dependency) around OWASP's recommendation for a single-user system:
 * throttle with increasing delay, never a hard account lockout (which is a
 * self-inflicted DoS). Independent limits, because an attacker controls both key
 * dimensions (ip and email) — `trustProxy` + nginx's `X-Forwarded-For` make
 * `request.ip` itself attacker-supplied, so an IP-only or (ip,email)-only bucket
 * is bypassable by rotating the forged IP:
 *
 *   1. per-`(ip,email)` exponential backoff — `min(1s · 2^(failures-1), 60s)`,
 *      cleared on success, entries expire after 1h;
 *   2. a per-IP bucket across all emails — so varying the email doesn't reset
 *      the clock;
 *   3. a per-EMAIL bucket across all IPs — IP-independent, so rotating the
 *      source IP (spoofed `X-Forwarded-For`) can't brute-force one account past
 *      the backoff;
 *   4. a global scrypt-concurrency cap — at most 2 verifications in flight;
 *      excess callers are told to retry BEFORE any hashing happens. Each scrypt
 *      costs ~128MB and ~100ms, so unthrottled parallel logins are a memory-DoS
 *      primitive regardless of backoff.
 *
 * The three maps are hard-capped (oldest-evicted) on top of the 1h expiry —
 * "expires in 1h" is not a memory bound when the attacker mints fresh keys.
 *
 * Testability (principle #10, the `CB_TIME` pattern): the core NEVER reads
 * `Date.now()`. Every time-dependent method takes an injected `now`, so the
 * doctest drives the whole backoff schedule with plain integers. The route is
 * the one impure boundary that passes `Date.now()` in.
 */

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 60_000;
/** Entries idle longer than this are discarded (lazily, on next access). */
const ENTRY_TTL_MS = 60 * 60 * 1000;
/** Hard cap per map; the oldest (least-recently-failed) entry is evicted. */
const MAX_ENTRIES = 4000;
/** At most this many scrypt verifications run concurrently. */
const MAX_CONCURRENT_HASHES = 2;

/** Retry hint (ms) returned when the global scrypt-concurrency cap is hit. */
export const CONCURRENCY_RETRY_MS = 500;

interface AttemptRecord {
  failures: number;
  lastFailureAt: number;
}

export interface ThrottleDecision {
  allowed: boolean;
  /** Milliseconds the caller should wait before retrying (0 when allowed). */
  retryAfterMs: number;
}

/** Backoff for N consecutive failures: `min(1s · 2^(N-1), 60s)`, 0 for N≤0. */
function backoffDelayMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(BASE_DELAY_MS * 2 ** (failures - 1), MAX_DELAY_MS);
}

function attemptKey({ ip, email }: { ip: string; email: string }): string {
  return `${ip}\n${email}`;
}

export class LoginThrottle {
  private readonly perKey = new Map<string, AttemptRecord>();
  private readonly perIp = new Map<string, AttemptRecord>();
  private readonly perEmail = new Map<string, AttemptRecord>();
  private inFlightHashes = 0;

  /**
   * Whether an attempt for `(ip,email)` is allowed right now. Blocked when ANY of
   * the `(ip,email)` backoff, the per-IP bucket, or the per-email bucket is still
   * cooling down; `retryAfterMs` is the longest of the waits.
   */
  check({ ip, email, now }: { ip: string; email: string; now: number }): ThrottleDecision {
    const keyWait = this.remainingWait({ map: this.perKey, key: attemptKey({ ip, email }), now });
    const ipWait = this.remainingWait({ map: this.perIp, key: ip, now });
    const emailWait = this.remainingWait({ map: this.perEmail, key: email, now });
    const retryAfterMs = Math.max(0, keyWait, ipWait, emailWait);
    return { allowed: retryAfterMs <= 0, retryAfterMs };
  }

  /** Record a failed attempt against the `(ip,email)` key, the IP bucket, and the
   *  email bucket (so neither a forged IP nor a varied email escapes the clock). */
  recordFailure({ ip, email, now }: { ip: string; email: string; now: number }): void {
    this.bump({ map: this.perKey, key: attemptKey({ ip, email }), now });
    this.bump({ map: this.perIp, key: ip, now });
    this.bump({ map: this.perEmail, key: email, now });
  }

  /**
   * Clear all three counters for a successful login. A success proves a
   * legitimate user (an attacker spraying never produces one), so the real user
   * is never throttled by their own earlier typos — nor by an attacker's failed
   * attempts against their email; during an actual attack there is no success, so
   * the escalating backoff stands.
   */
  recordSuccess({ ip, email }: { ip: string; email: string }): void {
    this.perKey.delete(attemptKey({ ip, email }));
    this.perIp.delete(ip);
    this.perEmail.delete(email);
  }

  /**
   * Try to reserve one of the global scrypt slots. Returns false when the cap
   * is already reached — the caller answers 429 WITHOUT hashing. Always pair a
   * `true` result with a `releaseHashSlot()` in a `finally`.
   */
  acquireHashSlot(): boolean {
    if (this.inFlightHashes >= MAX_CONCURRENT_HASHES) return false;
    this.inFlightHashes += 1;
    return true;
  }

  releaseHashSlot(): void {
    if (this.inFlightHashes > 0) this.inFlightHashes -= 1;
  }

  /** Observability seam (metrics/tests): current live entry counts. */
  stats(): { keyEntries: number; ipEntries: number; emailEntries: number; inFlightHashes: number } {
    return {
      keyEntries: this.perKey.size,
      ipEntries: this.perIp.size,
      emailEntries: this.perEmail.size,
      inFlightHashes: this.inFlightHashes,
    };
  }

  /** Drop all state — used by tests between independent scenarios. */
  reset(): void {
    this.perKey.clear();
    this.perIp.clear();
    this.perEmail.clear();
    this.inFlightHashes = 0;
  }

  private remainingWait({ map, key, now }: { map: Map<string, AttemptRecord>; key: string; now: number }): number {
    const record = map.get(key);
    if (!record) return 0;
    if (now - record.lastFailureAt >= ENTRY_TTL_MS) {
      map.delete(key);
      return 0;
    }
    return record.lastFailureAt + backoffDelayMs(record.failures) - now;
  }

  private bump({ map, key, now }: { map: Map<string, AttemptRecord>; key: string; now: number }): void {
    const existing = map.get(key);
    const failures = existing && now - existing.lastFailureAt < ENTRY_TTL_MS ? existing.failures + 1 : 1;
    // Delete-then-set moves the key to the Map's tail, so insertion order is
    // least-recently-failed first — exactly what eviction wants to drop.
    map.delete(key);
    map.set(key, { failures, lastFailureAt: now });
    while (map.size > MAX_ENTRIES) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
      console.warn(`[login-throttle] entry cap (${MAX_ENTRIES}) exceeded; evicted oldest key`);
    }
  }
}

/** Process-wide singleton — a single process holds the login surface (a
 *  standalone box or the hub), so in-memory state is correct and a
 *  restart-reset is acceptable for a backoff. */
export const loginThrottle = new LoginThrottle();
