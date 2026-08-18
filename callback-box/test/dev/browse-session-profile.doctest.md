# browse session profiles and the run timeout (bin/browse)

Chrome holds an exclusive `SingletonLock` on a profile directory and aborts
rather than open one another live instance owns. So every `bin/browse
--session <name>` needs its own profile, or only one session can be running at
a time — which is what made a second concurrent session impossible.

`run()`'s wall-clock ceiling is the other half of the same fix: agent-browser
0.27.0's `wait --fn` polls forever unless `AGENT_BROWSER_DEFAULT_TIMEOUT` is
set, and an unbounded child hung `screenshot`, `snapshot`, and `open`.

```ts setup
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sessionProfileDir } from "../../../browse/src/worktree.js";
import { run } from "../../../browse/packages/agent-browser-typed/src/runner.js";

const base = await mkdtemp(join(tmpdir(), "browse-profile-"));
process.env["BROWSE_PROFILE_BASE"] = base;

async function refused(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "(no error)";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
```

## Each session gets its own profile directory

Created on demand, and distinct per session name.

```ts
const alpha = await sessionProfileDir("alpha");
const beta = await sessionProfileDir("beta");
JSON.stringify({
  alpha: alpha === join(base, "profiles", "alpha"),
  distinct: alpha !== beta,
  bothExist: (await stat(alpha)).isDirectory() && (await stat(beta)).isDirectory(),
})
=> {"alpha":true,"distinct":true,"bothExist":true}
```

The name becomes a path segment, so it is sanitized rather than trusted: a
traversal attempt lands inside the base like any other name, and a name with
nothing usable left is refused instead of silently becoming the base itself.

```ts
const escaped = await sessionProfileDir("../../escape");
JSON.stringify({
  contained: escaped === join(base, "profiles", "escape"),
  empty: await refused(async () => sessionProfileDir("///")),
})
=> {"contained":true,"empty":"--session name has no usable characters for a profile directory: ///"}
```

Invoked outside `bin/browse` there is no base to put profiles under, and that
is an error rather than a guess at a location.

```ts
delete process.env["BROWSE_PROFILE_BASE"];
await refused(async () => sessionProfileDir("alpha"))
=> BROWSE_PROFILE_BASE is not set. Invoke via bin/browse, not directly.
```

## A child that ignores its own timeout is still killed

`timeoutMs` is the backstop under the settle wait: whatever the upstream
binary does about timeouts, the wrapper cannot hang forever.

```ts
process.env["BROWSE_PROFILE_BASE"] = base;
const killed = await refused(async () => run(["--version"], { timeoutMs: 1 }));
killed.includes("killed after 1ms")
=> true
```

```ts cleanup
await rm(base, { recursive: true, force: true });
```
