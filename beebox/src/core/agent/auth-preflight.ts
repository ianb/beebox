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

import {
  AUTH_PROBE_INCONCLUSIVE,
  createClaudeCliService,
  type ClaudeCliService,
} from "../../services/claude-cli.js";
import {
  createCodexCliService,
  redactCodexCliDetail,
  type CodexCliService,
} from "../../services/codex-cli.js";

export { redactCodexCliDetail as redactCodexAuthDetail } from "../../services/codex-cli.js";

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

export const CODEX_NOT_LOGGED_IN_MESSAGE =
  "Codex is not logged in — run `codex login --device-auth` as the Bee Box service user";

export class CodexReadinessError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CodexReadinessError";
  }
}

export class CodexAuthError extends CodexReadinessError {
  constructor() {
    super(CODEX_NOT_LOGGED_IN_MESSAGE);
    this.name = "CodexAuthError";
  }
}

export class CodexCliUnavailableError extends CodexReadinessError {
  readonly detail: string;

  constructor(detail: string) {
    const safeDetail = redactCodexCliDetail(detail);
    super("Codex CLI is unavailable — reinstall Bee Box's package dependencies", { cause: new Error(safeDetail) });
    this.name = "CodexCliUnavailableError";
    this.detail = safeDetail;
  }
}

// A confirmed login is cached this long. Generous — auth rarely changes mid
// process, and the health probe (live, uncached) is the surface for spotting a
// logout promptly. This cache only exists to keep run-path probes cheap.
const POSITIVE_TTL_MS = 10 * 60 * 1000;

let cachedOkAt: number | null = null;
let cachedCodexOkAt: number | null = null;

/**
 * A probe that returns no usable answer is retried once before we act on it.
 * `claude auth status` intermittently comes back empty on a machine that is
 * genuinely logged in — observed twice in roughly eight local procedure
 * invocations — and one retry clears it.
 */
async function probeAuth(claudeCli: ClaudeCliService): Promise<Record<string, unknown>> {
  const first = await claudeCli.authStatus();
  if (first[AUTH_PROBE_INCONCLUSIVE] !== true) return first;
  return claudeCli.authStatus();
}

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

export function resetCodexAuthCache(): void {
  cachedCodexOkAt = null;
}

export async function checkCodexAuth(options?: {
  codexCli?: CodexCliService | undefined;
  now?: (() => number) | undefined;
}): Promise<void> {
  const now = options?.now ?? Date.now;
  const at = now();
  if (cachedCodexOkAt !== null && at - cachedCodexOkAt < POSITIVE_TTL_MS) return;
  const status = await (options?.codexCli ?? createCodexCliService()).authStatus();
  switch (status.kind) {
    case "logged-in":
      cachedCodexOkAt = at;
      return;
    case "logged-out":
      throw new CodexAuthError();
    case "unavailable":
      {
        const error = new CodexCliUnavailableError(status.detail);
        console.warn("[codex-auth] readiness probe failed:", error);
        throw error;
      }
    case "inconclusive":
      console.warn(
        `[codex-auth] status probe was inconclusive; letting Codex report its runtime state: ${redactCodexCliDetail(status.detail)}`,
      );
      return;
  }
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
  const status = await probeAuth(claudeCli);
  if (status["loggedIn"] === true) {
    cachedOkAt = at;
    return;
  }
  if (status[AUTH_PROBE_INCONCLUSIVE] === true) {
    // Still no answer after a retry. Proceed rather than fail: this preflight
    // exists only to turn an opaque SDK auth failure into a clear message, so
    // when it cannot tell, the SDK call right behind it is the better judge —
    // it reports a real missing login precisely, and a false positive here
    // kills a run that would have succeeded. Not cached: the next call reprobes.
    console.warn(
      "Claude auth probe returned no usable answer twice; proceeding and letting " +
        "the agent invocation report auth state itself.",
    );
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
  backend: {
    requiresClaudeAuth?: boolean | undefined;
    requiresCodexAuth?: boolean | undefined;
  };
  engine?: "claude" | "codex" | undefined;
  session: { emit(event: "error", error: Error): boolean };
  /** CLI service for the probe. Omit in production; tests inject a fake. */
  claudeCli?: ClaudeCliService | undefined;
  codexCli?: CodexCliService | undefined;
}): Promise<boolean> {
  if (params.engine === "codex") {
    if (params.backend.requiresCodexAuth !== true) return true;
    try {
      await checkCodexAuth({ codexCli: params.codexCli });
      return true;
    } catch (error) {
      if (error instanceof CodexReadinessError) {
        params.session.emit("error", error);
        return false;
      }
      throw error;
    }
  }
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
