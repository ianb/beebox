import {
  AUTH_PROBE_INCONCLUSIVE,
  createClaudeCliService,
  type ClaudeCliService,
} from "../../../services/claude-cli.js";
import type { HealthCheck } from "./health.js";

/**
 * Claude Code auth, for agent operations (chat, reactor, procedures).
 *
 * Probes via `claude auth status` through the ClaudeCli service rather than
 * peeking at `~/.claude/.credentials.json`: that file only exists on Linux, so
 * the old file-peek skipped macOS entirely (where credentials live in the
 * Keychain), leaving local dev with no signal. The CLI reads whichever store
 * this platform uses.
 *
 * Three outcomes, not two. A probe that returns no usable answer is reported
 * as a warning that says so, never as "not logged in" — `claude auth status`
 * intermittently comes back empty on a machine that is genuinely logged in,
 * and naming the wrong remedy sends someone to re-authenticate for a problem
 * they do not have.
 */
export async function claudeAuthCheck(injected?: ClaudeCliService): Promise<HealthCheck> {
  const claudeCli = injected ?? createClaudeCliService();
  const authStatus = await claudeCli.authStatus();
  if (authStatus["loggedIn"] === true) {
    return {
      name: "claude-credentials",
      ok: true,
      message: "Claude Code is logged in",
      severity: "error",
    };
  }
  if (authStatus[AUTH_PROBE_INCONCLUSIVE] === true) {
    return {
      name: "claude-credentials",
      ok: false,
      message:
        "Claude Code auth could not be determined — `claude auth status` returned no " +
        "usable answer. Agent operations may still work; re-run this check before acting on it",
      severity: "warning",
    };
  }
  return {
    name: "claude-credentials",
    ok: false,
    message:
      "The assistant engine (Claude Code) isn't signed in on this server — chat and " +
      "background processing (reactor, procedures) will not work. Run `claude auth login` on this machine",
    severity: "error",
  };
}
