# Agent run-path Claude-auth preflight

`checkClaudeAuth` runs before a reactor run's agent turns and before an
interactive chat session's first SDK run. A missing/expired login otherwise
surfaces as an opaque `success: false` from the Agent SDK stream; the preflight
turns it into an actionable error instead. It probes `claude auth status` via
the `ClaudeCli` service (a fake here — no subprocess) and caches a positive
result so a wakeup cycle doesn't shell out per job.

```ts setup
import {
  checkClaudeAuth,
  checkCodexAuth,
  preflightChatBackend,
  resetClaudeAuthCache,
  resetCodexAuthCache,
  ClaudeAuthError,
  CodexAuthError,
  CLAUDE_NOT_LOGGED_IN_MESSAGE,
  CODEX_NOT_LOGGED_IN_MESSAGE,
  redactCodexAuthDetail,
} from "../../../src/core/agent/auth-preflight.js";
import { createFakeClaudeCli, AUTH_PROBE_INCONCLUSIVE } from "../../../src/services/claude-cli.js";
import { createFakeCodexCli } from "../../../src/services/codex-cli.js";
import { createChatBackend } from "../../../src/services/claude-chat.js";

/** A probe that answers `n` times with no usable result, then as given. */
function flakyCli(inconclusiveTimes, then) {
  let calls = 0;
  return {
    calls: () => calls,
    authStatus: async () => {
      calls += 1;
      return calls <= inconclusiveTimes ? { [AUTH_PROBE_INCONCLUSIVE]: true, raw: "" } : then;
    },
    authLogin: async () => ({ authUrl: null }),
    authLogout: async () => ({ success: true }),
  };
}
```

## Logged out → the check fails fast with the actionable message

```ts
resetClaudeAuthCache();
const claudeCli = createFakeClaudeCli({ loggedIn: false });
const thrown = await checkClaudeAuth({ claudeCli }).then(() => "no throw").catch((e) => `${e.name}: ${e.message}`);
thrown
=> ClaudeAuthError: Claude Code is not logged in — run `claude auth login` on this machine
```

The message is exported as a single constant so every consumer shows the same
remedy.

```ts continue
CLAUDE_NOT_LOGGED_IN_MESSAGE
=> Claude Code is not logged in — run `claude auth login` on this machine
```

## Logged in → the preflight passes through

`checkClaudeAuth` resolving (no throw) is the pass. A confirmed login is then
cached: a second call with a fake that would report logged-out still passes,
because the positive result short-circuits the probe.

```ts
resetClaudeAuthCache();
const loggedIn = createFakeClaudeCli({ loggedIn: true });
await checkClaudeAuth({ claudeCli: loggedIn });
const loggedOut = createFakeClaudeCli({ loggedIn: false });
await checkClaudeAuth({ claudeCli: loggedOut });
"passed through (cached)"
=> passed through (cached)
```

## `preflightChatBackend` gates on the real SDK and routes errors to the session

A fake chat backend leaves `requiresClaudeAuth` unset, so it always proceeds —
tests never shell out. A real backend (`requiresClaudeAuth: true`) with a
logged-out CLI emits `"error"` on the session and returns `false` so the run
aborts.

```ts
resetClaudeAuthCache();
const events = [];
const session = { emit: (event, err) => { events.push([event, err.message]); return true; } };

const proceedFake = await preflightChatBackend({ backend: {}, session });
JSON.stringify({ proceedFake, events })
=> {"proceedFake":true,"events":[]}
```

```ts continue
resetClaudeAuthCache();
const claudeCli = createFakeClaudeCli({ loggedIn: false });
const proceedReal = await preflightChatBackend({ backend: { requiresClaudeAuth: true }, session, claudeCli });
JSON.stringify({ proceedReal, events })
=> {"proceedReal":false,"events":[["error","Claude Code is not logged in — run `claude auth login` on this machine"]]}
```

## Codex has its own preflight and remedy

Codex does not reuse Claude's status shape or credentials. A confirmed logout
fails before plugin mutation or SDK startup and says which service identity
must log in.

```ts
resetCodexAuthCache();
const codexCli = createFakeCodexCli({ status: { kind: "logged-out" } });
const thrown = await checkCodexAuth({ codexCli }).then(() => "no throw").catch((e) => `${e.name}: ${e.message}`);
thrown
=> CodexAuthError: Codex is not logged in — run `codex login --device-auth` as the Bee Box service user
```

```ts continue
CODEX_NOT_LOGGED_IN_MESSAGE
=> Codex is not logged in — run `codex login --device-auth` as the Bee Box service user
```

A positive result is cached for the wakeup/chat burst. Logout and
inconclusive results are not cached.

```ts
resetCodexAuthCache();
const codexCli = createFakeCodexCli({ status: { kind: "logged-in" } });
await checkCodexAuth({ codexCli });
await checkCodexAuth({ codexCli });
codexCli.statusCalls
=> 1
```

```ts
resetCodexAuthCache();
const codexCli = createFakeCodexCli({ status: { kind: "logged-out" } });
await checkCodexAuth({ codexCli }).catch((e) => e instanceof CodexAuthError);
await checkCodexAuth({ codexCli }).catch((e) => e instanceof CodexAuthError);
codexCli.statusCalls
=> 2
```

An inconclusive process answer does not block a run the SDK may still complete,
and it is probed again next time rather than cached.

```ts
resetCodexAuthCache();
const codexCli = createFakeCodexCli({ status: { kind: "inconclusive", detail: "timed out" } });
await checkCodexAuth({ codexCli });
await checkCodexAuth({ codexCli });
codexCli.statusCalls
=> 2
```

The chat dispatch selects the provider preflight. A Codex engine does not
silently bypass auth and never calls the Claude fake.

```ts
resetCodexAuthCache();
const codexEvents = [];
const codexSession = { emit: (event, err) => { codexEvents.push([event, err.message]); return true; } };
const codexCli = createFakeCodexCli({ status: { kind: "logged-out" } });
const claudeCli = createFakeClaudeCli({ loggedIn: true });
const proceedCodex = await preflightChatBackend({
  backend: { requiresCodexAuth: true },
  engine: "codex",
  session: codexSession,
  claudeCli,
  codexCli,
});
JSON.stringify({ proceedCodex, codexEvents, codexCalls: codexCli.statusCalls })
=> {"proceedCodex":false,"codexEvents":[["error","Codex is not logged in — run `codex login --device-auth` as the Bee Box service user"]],"codexCalls":1}
```

The production composite backend carries both provider requirements. This is
the object the chat registry actually passes to the preflight.

```ts
const backend = createChatBackend();
JSON.stringify({ claude: backend.requiresClaudeAuth, codex: backend.requiresCodexAuth })
=> {"claude":true,"codex":true}
```

Status diagnostics preserve useful CLI context but redact credential-shaped
content before it becomes an error cause or log value.

```ts
redactCodexAuthDetail("warning for API key - sk-secret_123 and access token - abc123")
=> warning for API key - <redacted> and access token - <redacted>
```

## A probe that returns no answer is not a logout

`claude auth status` intermittently comes back empty on a machine that is
genuinely logged in. Reporting that as `loggedIn: false` failed whole procedure
runs and named a remedy (`claude auth login`) that wasn't the problem, so an
unusable probe is now its own state and gets one retry.

```ts
resetClaudeAuthCache();
const cli = flakyCli(1, { loggedIn: true });
await checkClaudeAuth({ claudeCli: cli });
print(`probes=${cli.calls()}`);
=>
probes=2
```

When the retry also comes back empty we still don't know — and the preflight
exists only to turn an opaque SDK failure into a clear message, so it stands
aside and lets the agent invocation behind it report auth state itself. Failing
here would kill a run that was going to succeed.

```ts
resetClaudeAuthCache();
const cli = flakyCli(2, { loggedIn: true });
const outcome = await checkClaudeAuth({ claudeCli: cli }).then(() => "proceeded").catch((e) => e.name);
print(`${outcome} after ${cli.calls()} probes`);
=>
proceeded after 2 probes
```

An inconclusive result is never cached as success — the next call probes again.

```ts continue
const after = await checkClaudeAuth({ claudeCli: cli }).then(() => "proceeded");
print(`${after}, total probes ${cli.calls()}`);
=>
proceeded, total probes 3
```

A real logout still fails closed: the probe answered, and the answer was no.

```ts
resetClaudeAuthCache();
const cli = flakyCli(1, { loggedIn: false });
const thrown = await checkClaudeAuth({ claudeCli: cli }).then(() => "no throw").catch((e) => e.name);
print(`${thrown} after ${cli.calls()} probes`);
=>
ClaudeAuthError after 2 probes
```
