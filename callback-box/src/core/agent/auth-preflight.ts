/**
 * Claude-auth preflight for agent runs.
 *
 * A missing or expired Claude Code login otherwise surfaces as an opaque
 * `success: false` from the Agent SDK stream (see `run.ts`). This checks auth
 * up front — before a reactor run's agent turns and before an interactive chat
 * session's first SDK run — and fails with an actionable message instead.
 *
 * `claude auth status` shells out with a 10s timeout, so a confirmed login is
 * cached for a generous TTL: a wakeup cycle processing many jobs (each a
 * separate agent turn) probes at most once, not per job. A negative result is
 * never cached, so a fresh `claude auth login` is picked up on the next run.
 */

import { createClaudeCliService, type ClaudeCliService } from "../../services/claude-cli.js";

/** The single actionable message shown when Claude Code has no active login. */
export const CLAUDE_NOT_LOGGED_IN_MESSAGE =
  "Claude Code is not logged in — run `claude auth login` on this machine";

/** Thrown by {@link checkClaudeAuth} when the CLI reports no active login. */
export class ClaudeAuthError extends Error {
  constructor() {
    super(CLAUDE_NOT_LOGGED_IN_MESSAGE);
    this.name = "ClaudeAuthError";
  }
}

// A confirmed login is cached this long. Generous — auth rarely changes mid
// process, and the health probe (live, uncached) is the surface for spotting a
// logout promptly. This cache only exists to keep run-path probes cheap.
const POSITIVE_TTL_MS = 10 * 60 * 1000;

let cachedOkAt: number | null = null;

export interface CheckClaudeAuthOptions {
  /**
   * CLI service for the probe. Omit in production — a real
   * `createClaudeCliService()` is constructed. Tests inject a fake.
   */
  claudeCli?: ClaudeCliService | undefined;
  /** Injectable clock (ms). Defaults to `Date.now`; tests override for TTL. */
  now?: (() => number) | undefined;
}

/** Clear the positive-result cache. Tests only. */
export function resetClaudeAuthCache(): void {
  cachedOkAt = null;
}

/**
 * Verify Claude Code has an active login. Resolves when logged in (caching the
 * positive result); throws {@link ClaudeAuthError} when not.
 */
export async function checkClaudeAuth(options?: CheckClaudeAuthOptions): Promise<void> {
  const now = options?.now ?? Date.now;
  const at = now();
  if (cachedOkAt !== null && at - cachedOkAt < POSITIVE_TTL_MS) return;

  const claudeCli = options?.claudeCli ?? createClaudeCliService();
  const status = await claudeCli.authStatus();
  if (status["loggedIn"] === true) {
    cachedOkAt = at;
    return;
  }
  throw new ClaudeAuthError();
}

/**
 * Chat-session preflight. A backend that talks to the real SDK
 * (`requiresClaudeAuth`) needs an active login; on a missing one, emit `"error"`
 * on `session` — the same channel a mid-run failure uses, which the send route
 * turns into a turn-buffer failure — and return `false` so the caller aborts
 * the run. Fakes leave `requiresClaudeAuth` unset and always proceed. Returns
 * `true` when the run may proceed.
 */
export async function preflightChatBackend(params: {
  backend: { requiresClaudeAuth?: boolean | undefined };
  session: { emit(event: "error", error: Error): boolean };
  /** CLI service for the probe. Omit in production; tests inject a fake. */
  claudeCli?: ClaudeCliService | undefined;
}): Promise<boolean> {
  if (params.backend.requiresClaudeAuth !== true) return true;
  try {
    await checkClaudeAuth({ claudeCli: params.claudeCli });
    return true;
  } catch (e) {
    if (e instanceof ClaudeAuthError) {
      params.session.emit("error", e);
      return false;
    }
    throw e;
  }
}
