/**
 * First-run setup token.
 *
 * When authentication is required and the credential store does not exist, the
 * server prints a one-time claim link to the console at listen time (the Jupyter
 * shape — a boot-logged token — rather than Portainer's self-terminating
 * service, which on a personal server would read as a crash). The token gates
 * `POST /auth/setup`, which creates the owner account.
 *
 * Two properties matter for safety:
 *   - it lives ONLY in memory and is printed ONLY to the console — it never
 *     appears in any served page, because an unauthenticated endpoint that
 *     handed out the setup capability would defeat it;
 *   - it expires 15 minutes after it was armed. A restart re-arms it, so an
 *     unattended exposed server with zero users is not claimable indefinitely
 *     and a leaked old log line is worthless.
 *
 * Injected clock (principle #10): `armSetupToken`/`checkSetupToken` take `now`,
 * so a doctest can arm a token "in the past" to exercise expiry without waiting.
 */

import * as crypto from "node:crypto";
import { getOwnerEmail } from "./auth.js";
import { isLocalAuthStoreInitialized } from "./local-users.js";
import { AuthStoreUnavailableError } from "./local-users-errors.js";

const SETUP_TOKEN_TTL_MS = 15 * 60 * 1000;

interface SetupToken {
  token: string;
  expiresAt: number;
}

let current: SetupToken | null = null;

/** How a presented token relates to the live one. */
export type SetupTokenStatus =
  /** Matches a live, unexpired token — proceed. */
  | "valid"
  /** A live token exists but the presented value doesn't match it. */
  | "mismatch"
  /** A token was armed but its 15-minute window has passed. */
  | "expired"
  /** No token is armed (never booted into first-run, or already claimed). */
  | "absent";

/** Arm a fresh single-use setup token expiring `SETUP_TOKEN_TTL_MS` after `now`. */
export function armSetupToken({ now }: { now: number }): string {
  const token = crypto.randomBytes(32).toString("base64url");
  current = { token, expiresAt: now + SETUP_TOKEN_TTL_MS };
  return token;
}

/** Classify a presented token against the live one (timing-safe on match). */
export function checkSetupToken({ token, now }: { token: string; now: number }): SetupTokenStatus {
  if (!current) return "absent";
  if (now >= current.expiresAt) return "expired";
  const provided = Buffer.from(token);
  const expected = Buffer.from(current.token);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return "mismatch";
  return "valid";
}

/** Retire the token once the owner account is created (or to disarm). */
export function clearSetupToken(): void {
  current = null;
}

/**
 * At listen time, when auth is required AND the server has no owner at all, arm
 * a setup token and print the claim link. No-op in open access (there's no
 * wall), once a local user exists, or when an owner is already established some
 * other way. A corrupt/unreadable store degrades to "no setup link" with a loud
 * error — logins will surface the store problem per-request.
 *
 * The owner check is not the same as the zero-local-users check. A server whose
 * owner signs in through Google OAuth (`BBX_OWNER_EMAIL` set, no local password
 * account) has zero local users *permanently*, so the user-count test alone
 * re-armed and re-printed a setup link on every single restart — 105 times on
 * the deployed server before this was noticed. That link was never usable
 * (`POST /auth/setup` refuses to create an owner that doesn't match
 * `BBX_OWNER_EMAIL`), so it was pure noise that read as an unclaimed server.
 */
export function maybeArmFirstRunSetup({ publicUrl, openAccess }: { publicUrl: string; openAccess: boolean }): void {
  if (openAccess) return;
  // An owner already exists (env override or a local owner account) — there is
  // nothing to claim, so no token and no link.
  if (getOwnerEmail() !== null) return;
  let storeInitialized: boolean;
  try {
    storeInitialized = isLocalAuthStoreInitialized();
  } catch (e) {
    if (e instanceof AuthStoreUnavailableError) {
      console.error("[auth] cannot check for first-run setup — credential store unavailable:", e);
      return;
    }
    throw e;
  }
  if (storeInitialized) return;
  const token = armSetupToken({ now: Date.now() });
  console.log(`First-run setup: ${publicUrl}/auth/setup?token=${token}`);
}
