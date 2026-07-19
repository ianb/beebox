# Health check: `claude-credentials` probes `claude auth status`

`runHealthChecks`'s Claude-auth check used to peek at
`~/.claude/.credentials.json` and skip the check entirely on macOS (where
Claude Code keeps credentials in the Keychain, not that file) — so local dev
on a Mac got no signal at all. It now probes `claude auth status` through the
injected `ClaudeCli` service, which reads whichever credential store the
platform uses. Tests inject a fake so no subprocess spawns.

```ts setup
import { runHealthChecks } from "../../src/webapp/trpc/routers/health.js";
import { createFakeClaudeCli } from "../../src/services/claude-cli.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const claudeCheck = (checks) => checks.find((c) => c.name === "claude-credentials");
```

## Logged in → the check passes

```ts
const box = await makeTmpBox();
const claudeCli = createFakeClaudeCli({ loggedIn: true });
const checks = await runHealthChecks(box.root, { claudeCli });
JSON.stringify(claudeCheck(checks))
=> {"name":"claude-credentials","ok":true,"message":"Claude Code is logged in","severity":"error"}
```

```ts cleanup
await box.cleanup();
```

## Logged out → the check fails with an actionable message (on every platform)

```ts
const box = await makeTmpBox();
const claudeCli = createFakeClaudeCli({ loggedIn: false });
const checks = await runHealthChecks(box.root, { claudeCli });
JSON.stringify(claudeCheck(checks))
=> {"name":"claude-credentials","ok":false,"message":"Claude Code is not logged in — agent operations (chat, reactor, procedures) will not work. Run `claude auth login` on this machine","severity":"error"}
```

```ts cleanup
await box.cleanup();
```
