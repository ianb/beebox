/**
 * Google OAuth token storage — the on-disk credential record and every read or
 * write of it. The OAuth2 *client* built from these tokens lives in
 * `google-auth.ts`; this file knows only about the file.
 *
 * Storage: centralized via the CB_GOOGLE_TOKENS_FILE env var (preferred), or
 * per-box config/connectors/google.secret.json (legacy fallback). The
 * centralized case means ONE refresh token is shared by gmail/calendar/drive
 * across every box on the server — which is why the "this grant is dead" state
 * lives here, with the credential, rather than in per-connector or per-box
 * state. See docs/plans/google-auth-reauth-health.md.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../lib/error-guards.js";
import { withCardLock } from "../lib/card-lock.js";
import { acquireLock, releaseLock, requestScopedLock, LockHeldError } from "../lib/file-lock.js";
import { sleep } from "../lib/sleep.js";
import { getBoxTimeISO } from "../lib/time.js";

class NoTokenStoragePathError extends Error {
  constructor() {
    super("No token storage path: set CB_GOOGLE_TOKENS_FILE or provide boxRoot");
    this.name = "NoTokenStoragePathError";
  }
}

/**
 * Thrown when the token file stays cross-process-locked past the retry budget —
 * real contention (another process holding it for seconds), not the transient
 * collisions the retry loop absorbs.
 */
class GoogleTokenLockError extends Error {
  readonly lockPath: string;
  constructor(lockPath: string) {
    super(`Google token lock could not be acquired: ${lockPath}`);
    this.name = "GoogleTokenLockError";
    this.lockPath = lockPath;
  }
}

const LOCK_RETRIES = 50;
const LOCK_RETRY_MS = 100;

export interface GoogleTokens {
  refreshToken?: string;
  accessToken?: string;
  tokenExpiry?: string;
  /**
   * Set when a token refresh failed with `invalid_grant` — the grant itself is
   * dead (expired or revoked) and only a fresh authorization fixes it.
   */
  needsReauthSince?: string;
  /** Short reason from the failing refresh, for the health message. */
  reauthReason?: string;
  /** Last time the grant was known good (a real refresh, or the daily probe). */
  authCheckedAt?: string;
}

function legacySecretPath(boxRoot: string): string {
  return path.join(boxRoot, "config/connectors/google.secret.json");
}

/**
 * Resolve the centralized token file path.
 * Returns the path from CB_GOOGLE_TOKENS_FILE env var, or null if not set.
 */
function centralTokenPath(): string | null {
  return process.env.CB_GOOGLE_TOKENS_FILE || null;
}

/**
 * Resolve the file a token write lands in — the centralized path when
 * configured, else the per-box legacy file. Null when neither is available.
 */
function googleTokenWritePath(boxRoot?: string): string | null {
  return centralTokenPath() || (boxRoot ? legacySecretPath(boxRoot) : null);
}

/**
 * Load Google tokens from disk. Checks centralized path first, then
 * falls back to per-box google.secret.json for backward compatibility.
 */
export async function loadGoogleTokens(boxRoot?: string): Promise<GoogleTokens | null> {
  // Try centralized file first
  const central = centralTokenPath();
  if (central) {
    try {
      const content = await fs.readFile(central, "utf-8");
      return JSON.parse(content);
    } catch (e) {
      // Usually the file doesn't exist yet; fall through to the legacy
      // location. Log at debug so a real read/parse error is still visible.
      if (errnoCode(e) !== "ENOENT") {
        console.debug("Could not read centralized Google tokens file, falling back:", e);
      }
    }
  }

  // Fall back to per-box legacy file
  if (boxRoot) {
    try {
      const content = await fs.readFile(legacySecretPath(boxRoot), "utf-8");
      return JSON.parse(content);
    } catch (e) {
      // No legacy tokens file (or it's unreadable) — treat as "no tokens".
      // Log at debug so a real read/parse error is still visible.
      if (errnoCode(e) !== "ENOENT") {
        console.debug("Could not read legacy Google tokens file:", e);
      }
      return null;
    }
  }

  return null;
}

/**
 * Serialized read-modify-write on the token file, with BOTH locks.
 *
 * `withCardLock` (in-process) is the OUTER lock and the cross-process file lock
 * is the INNER one, on a SIBLING `<tokens>.lock` path — the layering and the
 * reasoning behind it are documented on `updateTransientState` in
 * `transient-state.ts`. The cross-process half is load-bearing here because
 * under `cb hub` every box is its own process: a `needsReauth` flag written by
 * one box's connector can race the clear written by another box's OAuth
 * callback, and a lost update there would leave a stale "reconnect" nag.
 */
async function updateGoogleTokens(
  targetPath: string,
  update: (existing: GoogleTokens) => GoogleTokens,
): Promise<void> {
  const lockPath = `${targetPath}.lock`;
  // Request-scoped: a short critical section whose callers fail fast (~5 s
  // retry budget), so a crashed holder must clear in seconds, not minutes.
  const lock = requestScopedLock(lockPath);
  await withCardLock(targetPath, async () => {
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
      try {
        await acquireLock(lock, { purpose: "google-tokens" });
      } catch (e) {
        if (e instanceof LockHeldError) {
          // Held by ANOTHER process — withCardLock already serialized ours.
          await sleep(LOCK_RETRY_MS);
          continue;
        }
        throw e;
      }
      try {
        let existing: GoogleTokens = {};
        try {
          const content = await fs.readFile(targetPath, "utf-8");
          existing = JSON.parse(content);
        } catch (e) {
          // No existing tokens file (or unreadable) — start fresh and merge into {}.
          // Log at debug so a real read/parse error is still visible.
          if (errnoCode(e) !== "ENOENT") {
            console.debug("Could not read existing Google tokens file, starting fresh:", e);
          }
        }
        await fs.writeFile(targetPath, JSON.stringify(update(existing), null, 2));
        return;
      } finally {
        await releaseLock(lock);
      }
    }
    throw new GoogleTokenLockError(lockPath);
  });
}

/**
 * Save Google tokens. Writes to centralized path if configured,
 * otherwise falls back to per-box path.
 *
 * An update carrying a fresh access or refresh token is proof the grant works,
 * so it also CLEARS any `needsReauth` state and stamps `authCheckedAt`. Both
 * the OAuth callback and the auto-refresh `tokens` listener go through here, so
 * repair can't be forgotten by a new call path.
 */
export async function saveGoogleTokens(
  updates: Partial<GoogleTokens>,
  opts?: { boxRoot?: string },
): Promise<void> {
  const { boxRoot } = opts ?? {};
  const targetPath = googleTokenWritePath(boxRoot);
  if (!targetPath) {
    throw new NoTokenStoragePathError();
  }

  const provesGrantWorks = !!(updates.accessToken || updates.refreshToken);
  await updateGoogleTokens(targetPath, (existing) => {
    const merged = { ...existing, ...updates };
    if (provesGrantWorks) {
      delete merged.needsReauthSince;
      delete merged.reauthReason;
      merged.authCheckedAt = getBoxTimeISO(boxRoot);
    }
    return merged;
  });
}

/**
 * Record that the stored grant is dead — a refresh came back `invalid_grant`,
 * so only a fresh authorization will fix it. Idempotent: an existing
 * `needsReauthSince` is preserved so the health message and the notification
 * latch both keep pointing at when the breakage actually started.
 */
export async function markGoogleAuthDead(opts: {
  boxRoot?: string | undefined;
  reason: string;
}): Promise<void> {
  const targetPath = googleTokenWritePath(opts.boxRoot);
  if (!targetPath) {
    throw new NoTokenStoragePathError();
  }
  const nowIso = getBoxTimeISO(opts.boxRoot);
  await updateGoogleTokens(targetPath, (existing) => ({
    ...existing,
    needsReauthSince: existing.needsReauthSince ?? nowIso,
    reauthReason: opts.reason,
    authCheckedAt: nowIso,
  }));
}
