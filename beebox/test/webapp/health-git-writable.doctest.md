# Health check: `git-writable` is shape-aware

`runHealthChecks`'s `git-writable` check probes the git repository, which
for a v2 (package-layout) box lives at the PACKAGE root — `content/` is a
plain subdirectory with no `.git` of its own (see "One git repository at the
repo root" in `docs/implemented-plans/boxes-as-packages-v2.md`) — so the
check must resolve the box shape and probe `packageRoot/.git/objects`.

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

## v2 box: `.git/objects` lives at the PACKAGE root, one level above `content/`

A `.git/objects` sitting inside `content/` (the legacy location) must NOT
satisfy the check — only the package root's `.git` counts.

```ts
const box = await makeTmpBox();
await fs.mkdir(box.path(".git/objects"), { recursive: true });
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

## v2 box: `.git/objects` present at the package root passes

```ts
const box = await makeTmpBox();
await fs.mkdir(join(box.packageRoot, ".git/objects"), { recursive: true });
const checks = await runHealthChecks(box.root, { claudeCli });
JSON.stringify(gitWritableCheck(checks))
=> {"name":"git-writable","ok":true,"message":".git/objects is writable","severity":"error"}
```

```ts cleanup
await box.cleanup();
```
