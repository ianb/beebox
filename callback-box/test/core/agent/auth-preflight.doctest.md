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
  preflightChatBackend,
  resetClaudeAuthCache,
  ClaudeAuthError,
  CLAUDE_NOT_LOGGED_IN_MESSAGE,
} from "../../../src/core/agent/auth-preflight.js";
import { createFakeClaudeCli } from "../../../src/services/claude-cli.js";
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
