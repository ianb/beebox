// # Health check: `claude-credentials` probes `claude auth status`
//
// `runHealthChecks`'s Claude-auth check used to peek at
// `~/.claude/.credentials.json` and skip the check entirely on macOS (where
// Claude Code keeps credentials in the Keychain, not that file) — so local dev
// on a Mac got no signal at all. It now probes `claude auth status` through the
// injected `ClaudeCli` service, which reads whichever credential store the
// platform uses. Tests inject a fake so no subprocess spawns.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { runHealthChecks, type HealthCheck } from "../../../../../../src/webapp/trpc/routers/health/router.js";
import { createFakeClaudeCli, AUTH_PROBE_INCONCLUSIVE } from "../../../../../../src/services/claude-cli.js";
import { makeTmpBox } from "../../../../../helpers/test-helpers.js";

const claudeCheck = (checks: HealthCheck[]) => checks.find((c) => c.name === "claude-credentials");

// ## Logged in → the check passes
void test("Logged in → the check passes", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const claudeCli = createFakeClaudeCli({ loggedIn: true });
  const checks = await runHealthChecks(box.root, { claudeCli });
  t.check(claudeCheck(checks), {
    name: "claude-credentials",
    ok: true,
    message: "Claude Code is logged in",
    severity: "error",
  });
});

// ## Logged out → the check fails with an actionable message (on every platform)
void test("Logged out → the check fails with an actionable message (on every platform)", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const claudeCli = createFakeClaudeCli({ loggedIn: false });
  const checks = await runHealthChecks(box.root, { claudeCli });
  t.check(claudeCheck(checks), {
    name: "claude-credentials",
    ok: false,
    message: "The assistant engine (Claude Code) isn't signed in on this server — chat and background processing (reactor, procedures) will not work. Run `claude auth login` on this machine, or grant the `claude-oauth-token` secret to this box",
    severity: "error",
  });
});

// ## Probe returned nothing → a warning that says so, not "not logged in"
//
// `claude auth status` intermittently comes back empty on a machine that is
// genuinely logged in. Reporting that as a red "not logged in" sends someone to
// re-authenticate for a problem they don't have, so an unusable probe gets its
// own message and drops to `warning`.
void test("claude auth status intermittently comes back empty on a machine that is genui...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const claudeCli = {
    authStatus: async () => ({ [AUTH_PROBE_INCONCLUSIVE]: true, raw: "" }),
    authLogin: async () => ({ authUrl: null }),
    authLogout: async () => ({ success: true }),
    authSubmitCode: async () => ({ accepted: false }),
  };
  const checks = await runHealthChecks(box.root, { claudeCli });
  t.check(claudeCheck(checks), {
    name: "claude-credentials",
    ok: false,
    message: "Claude Code auth could not be determined — `claude auth status` returned no usable answer. Agent operations may still work; re-run this check before acting on it",
    severity: "warning",
  });
});
