# browse session profiles (`bin/browse`)

Chrome holds an exclusive `SingletonLock` on a profile directory and aborts
rather than open one another live instance owns. So every `bin/browse
--session <name>` needs its own profile, or only one session can be running at
a time — which is what made a second concurrent session impossible.

```ts setup
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sessionProfileDir } from "../src/worktree.js";

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

Sanitizing is lossy, so a rewritten name also carries a digest of the original.
Otherwise `a/b` and `a-b` would both reduce to `a-b` and share one profile —
reintroducing the collision this exists to prevent.

```ts
const escaped = await sessionProfileDir("../../escape");
const slashed = await sessionProfileDir("a/b");
const dashed = await sessionProfileDir("a-b");
JSON.stringify({
  contained: escaped.startsWith(join(base, "profiles", "escape-")),
  dashedIsVerbatim: dashed === join(base, "profiles", "a-b"),
  noCollision: slashed !== dashed,
  empty: await refused(async () => sessionProfileDir("///")),
})
=> {"contained":true,"dashedIsVerbatim":true,"noCollision":true,"empty":"--session name has no usable characters for a profile directory: ///"}
```

Invoked outside `bin/browse` there is no base to put profiles under, and that
is an error rather than a guess at a location.

```ts
delete process.env["BROWSE_PROFILE_BASE"];
await refused(async () => sessionProfileDir("alpha"))
=> BROWSE_PROFILE_BASE is not set. Invoke via bin/browse, not directly.
```

```ts cleanup
await rm(base, { recursive: true, force: true });
```
