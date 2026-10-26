// # Agent run-path Claude-auth preflight
//
// `checkClaudeAuth` runs before a reactor run's agent turns and before an
// interactive chat session's first SDK run. A missing/expired login otherwise
// surfaces as an opaque `success: false` from the Agent SDK stream; the preflight
// turns it into an actionable error instead. It probes `claude auth status` via
// the `ClaudeCli` service (a fake here — no subprocess) and caches a positive
// result so a wakeup cycle doesn't shell out per job.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { instanceOf } from "@ianbicking/tap-check/check";
import {
  checkClaudeAuth,
  checkCodexAuth,
  preflightChatBackend,
  resetClaudeAuthCache,
  resetCodexAuthCache,
  CodexAuthError,
  redactCodexAuthDetail,
} from "../../../src/core/agent/auth-preflight.js";
import { createFakeClaudeCli, AUTH_PROBE_INCONCLUSIVE, type ClaudeCliService } from "../../../src/services/claude-cli.js";
import { createFakeCodexCli } from "../../../src/services/codex-cli/core.js";
import { createChatBackend } from "../../../src/services/claude-chat/core.js";

/** Run with console.error captured: a refused run logs its reason, which these examples show. */
async function capturingErrors<T>(run: () => Promise<T>) {
  const logged: string[] = [];
  const { error } = console;
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  try { return { result: await run(), logged }; }
  finally { console.error = error; }
}

/** A probe that answers `n` times with no usable result, then as given. */
function flakyCli(inconclusiveTimes: number, then: Record<string, unknown>): ClaudeCliService & { calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    authStatus: async () => {
      calls += 1;
      return calls <= inconclusiveTimes ? { [AUTH_PROBE_INCONCLUSIVE]: true, raw: "" } : then;
    },
    authLogin: async () => ({ authUrl: null }),
    authLogout: async () => ({ success: true }),
    authSubmitCode: async () => ({ accepted: true }),
  };
}

// ## Logged out → the check fails fast with the actionable message
void test("Logged out → the check fails fast with the actionable message", async (t) => {
  resetClaudeAuthCache();
  const claudeCli = createFakeClaudeCli({ loggedIn: false });
  const thrown = await checkClaudeAuth({ claudeCli }).then(() => "no throw").catch((e) => `${e.name}: ${e.message}`);
  t.check(thrown, "ClaudeAuthError: Claude Code is not logged in — run `claude auth login` on this machine, or grant the `claude-oauth-token` secret to this box");
});

// ## Logged in → the preflight passes through
//
// `checkClaudeAuth` resolving (no throw) is the pass. A confirmed login is then
// cached: a second call with a fake that would report logged-out still passes,
// because the positive result short-circuits the probe.
void test("checkClaudeAuth resolving (no throw) is the pass.", async (t) => {
  resetClaudeAuthCache();
  const loggedIn = createFakeClaudeCli({ loggedIn: true });
  await checkClaudeAuth({ claudeCli: loggedIn });
  const loggedOut = createFakeClaudeCli({ loggedIn: false });
  await t.check(checkClaudeAuth({ claudeCli: loggedOut }), undefined);
});

// ## `preflightChatBackend` gates on the real SDK and routes errors to the session
//
// A fake chat backend leaves `requiresClaudeAuth` unset, so it always proceeds —
// tests never shell out. A real backend (`requiresClaudeAuth: true`) with a
// logged-out CLI emits `"error"` on the session and returns `false` so the run
// aborts. The reason is also logged: a sender with no listener on the session,
// such as quick chat, would otherwise leave no trace of why the run did not start.
void test("A fake chat backend leaves requiresClaudeAuth unset, so it always proceeds —...", async (t) => {
  resetClaudeAuthCache();
  const events: Array<[string, string]> = [];
  const session = { emit: (event: "error", err: Error) => { events.push([event, err.message]); return true; } };

  const proceedFake = await preflightChatBackend({ backend: {}, session });
  t.check({ proceedFake, events }, {
    proceedFake: true,
    events: [],
  });

  resetClaudeAuthCache();
  const claudeCli = createFakeClaudeCli({ loggedIn: false });
  const { result: proceedReal, logged } = await capturingErrors(() => preflightChatBackend({ backend: { requiresClaudeAuth: true }, session, claudeCli }));
  t.check({ proceedReal, events, logged }, {
    proceedReal: false,
    events: [
      [
        "error",
        "Claude Code is not logged in — run `claude auth login` on this machine, or grant the `claude-oauth-token` secret to this box",
      ],
    ],
    logged: [
      "[chat-preflight] run refused: Claude Code is not logged in — run `claude auth login` on this machine, or grant the `claude-oauth-token` secret to this box",
    ],
  });
});

// ## Codex has its own preflight and remedy
//
// Codex does not reuse Claude's status shape or credentials. A confirmed logout
// fails before plugin mutation or SDK startup and says which service identity
// must log in.
void test("Codex does not reuse Claude's status shape or credentials.", async (t) => {
  resetCodexAuthCache();
  const codexCli = createFakeCodexCli({ status: { kind: "logged-out" } });
  const thrown = await checkCodexAuth({ codexCli }).then(() => "no throw").catch((e) => `${e.name}: ${e.message}`);
  t.check(thrown, "CodexAuthError: Codex is not logged in — run `codex login --device-auth` as the Bee Box service user");
});

// A positive result is cached for the wakeup/chat burst. Logout and
// inconclusive results are not cached.
void test("A positive result is cached for the wakeup/chat burst.", async (t) => {
  resetCodexAuthCache();
  const codexCli = createFakeCodexCli({ status: { kind: "logged-in" } });
  await checkCodexAuth({ codexCli });
  await checkCodexAuth({ codexCli });
  t.check(codexCli.statusCalls, 1);
});

void test("Codex has its own preflight and remedy", async (t) => {
  resetCodexAuthCache();
  const codexCli = createFakeCodexCli({ status: { kind: "logged-out" } });
  t.check(await checkCodexAuth({ codexCli }).then(() => "no throw", (e: unknown) => e), instanceOf(CodexAuthError));
  t.check(await checkCodexAuth({ codexCli }).then(() => "no throw", (e: unknown) => e), instanceOf(CodexAuthError));
  t.check(codexCli.statusCalls, 2);
});

// An inconclusive process answer does not block a run the SDK may still complete,
// and it is probed again next time rather than cached.
void test("An inconclusive process answer does not block a run the SDK may still complet...", async (t) => {
  resetCodexAuthCache();
  const codexCli = createFakeCodexCli({ status: { kind: "inconclusive", detail: "timed out" } });
  await checkCodexAuth({ codexCli });
  await checkCodexAuth({ codexCli });
  t.check(codexCli.statusCalls, 2);
});

// The chat dispatch selects the provider preflight. A Codex engine does not
// silently bypass auth and never calls the Claude fake.
void test("The chat dispatch selects the provider preflight.", async (t) => {
  resetCodexAuthCache();
  const codexEvents: Array<[string, string]> = [];
  const codexSession = { emit: (event: "error", err: Error) => { codexEvents.push([event, err.message]); return true; } };
  const codexCli = createFakeCodexCli({ status: { kind: "logged-out" } });
  const claudeCli = createFakeClaudeCli({ loggedIn: true });
  const { result: proceedCodex } = await capturingErrors(() => preflightChatBackend({
    backend: { requiresCodexAuth: true },
    engine: "codex",
    session: codexSession,
    claudeCli,
    codexCli,
  }));
  t.check({ proceedCodex, codexEvents, codexCalls: codexCli.statusCalls }, {
    proceedCodex: false,
    codexEvents: [
      [
        "error",
        "Codex is not logged in — run `codex login --device-auth` as the Bee Box service user",
      ],
    ],
    codexCalls: 1,
  });
});

// The production composite backend carries both provider requirements. This is
// the object the chat registry actually passes to the preflight.
void test("The production composite backend carries both provider requirements.", async (t) => {
  const backend = createChatBackend();
  t.check({ claude: backend.requiresClaudeAuth, codex: backend.requiresCodexAuth }, {
    claude: true,
    codex: true,
  });
});

// Status diagnostics preserve useful CLI context but redact credential-shaped
// content before it becomes an error cause or log value.
void test("Status diagnostics preserve useful CLI context but redact credential-shaped c...", async (t) => {
  t.check(redactCodexAuthDetail("warning for API key - sk-secret_123 and access token - abc123"), "warning for API key - <redacted> and access token - <redacted>");
});

// ## A probe that returns no answer is not a logout
//
// `claude auth status` intermittently comes back empty on a machine that is
// genuinely logged in. Reporting that as `loggedIn: false` failed whole procedure
// runs and named a remedy (`claude auth login`) that wasn't the problem, so an
// unusable probe is now its own state and gets one retry.
void test("claude auth status intermittently comes back empty on a machine that is genui...", async (t) => {
  resetClaudeAuthCache();
  const cli = flakyCli(1, { loggedIn: true });
  await checkClaudeAuth({ claudeCli: cli });
  t.check(cli.calls(), 2);
});

// When the retry also comes back empty we still don't know — and the preflight
// exists only to turn an opaque SDK failure into a clear message, so it stands
// aside and lets the agent invocation behind it report auth state itself. Failing
// here would kill a run that was going to succeed.
void test("When the retry also comes back empty we still don't know — and the preflight...", async (t) => {
  resetClaudeAuthCache();
  const cli = flakyCli(2, { loggedIn: true });
  const outcome = await checkClaudeAuth({ claudeCli: cli }).then(() => "proceeded").catch((e) => e.name);
  t.check({ outcome, probes: cli.calls() }, { outcome: "proceeded", probes: 2 });

  // An inconclusive result is never cached as success — the next call probes again.

  const after = await checkClaudeAuth({ claudeCli: cli }).then(() => "proceeded");
  t.check({ after, probes: cli.calls() }, { after: "proceeded", probes: 3 });
});

// A real logout still fails closed: the probe answered, and the answer was no.
void test("A real logout still fails closed:", async (t) => {
  resetClaudeAuthCache();
  const cli = flakyCli(1, { loggedIn: false });
  const thrown = await checkClaudeAuth({ claudeCli: cli }).then(() => "no throw").catch((e) => e.name);
  t.check({ thrown, probes: cli.calls() }, { thrown: "ClaudeAuthError", probes: 2 });
});
