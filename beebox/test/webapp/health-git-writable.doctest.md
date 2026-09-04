# Health check: `git-writable` is shape-aware

`runHealthChecks`'s `git-writable` check probes the git repository, which
under the one-root layout (shapeVersion 3) lives at the box root itself —
so the check must resolve the box shape and probe `boxRoot/.git/objects`.

```ts setup
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { runHealthChecks } from "../../src/webapp/trpc/routers/health.js";
import { failedWritability } from "../../src/webapp/trpc/routers/health-writability.js";
import { createFakeClaudeCli } from "../../src/services/claude-cli.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const gitWritableCheck = (checks) => checks.find((c) => c.name === "git-writable");
// Inject a fake so the claude-auth check never shells out to real `claude`.
const claudeCli = createFakeClaudeCli({ loggedIn: true });
```

## No `.git/objects` at the box root fails

```ts
const box = await makeTmpBox();
const checks = await runHealthChecks(box.root, { claudeCli });
JSON.stringify(gitWritableCheck(checks))
=> {"name":"git-writable","ok":false,"message":".git/objects is missing — commits will fail; verify the Git repository at «*»","severity":"error"}
```

```ts cleanup
await box.cleanup();
```

## A failed probe does not guess at ownership

Missing paths are distinguishable from other failures, but an execution
sandbox and filesystem permissions can both reject the probe. The health check
reports that ambiguity instead of prescribing a destructive ownership change
it cannot justify.

```ts
JSON.stringify([
  failedWritability(Object.assign(new Error("missing"), { code: "ENOENT" })),
  failedWritability(Object.assign(new Error("denied"), { code: "EACCES" })),
  failedWritability(Object.assign(new Error("sandboxed"), { code: "EPERM" })),
])
=> ["missing","not-writable","not-writable"]
```

## `.git/objects` present at the box root passes

```ts
const box = await makeTmpBox();
await fs.mkdir(join(box.root, ".git/objects"), { recursive: true });
const checks = await runHealthChecks(box.root, { claudeCli });
JSON.stringify(gitWritableCheck(checks))
=> {"name":"git-writable","ok":true,"message":".git/objects is writable","severity":"error"}
```

```ts cleanup
await box.cleanup();
```
