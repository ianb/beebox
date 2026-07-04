# Health check: `git-writable` is shape-aware

`runHealthChecks`'s `git-writable` check used to always probe
`<boxRoot>/.git/objects`. For a legacy (shapeVersion 1) box `boxRoot` IS the
git root, so that was correct. For a v2 (package-layout) box the git
repository lives at the PACKAGE root — `content/` is a plain subdirectory
with no `.git` of its own (see "One git repository at the repo root" in
`docs/plans/boxes-as-packages-v2.md`) — so the check must resolve via
`getBoxShapeOrLegacyFallback` and probe `packageRoot/.git/objects` instead.

```ts setup
import * as fs from "node:fs/promises";
import { runHealthChecks } from "../../src/webapp/trpc/routers/health.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const gitWritableCheck = (checks) => checks.find((c) => c.name === "git-writable");
```

## Legacy box: `.git/objects` lives at the box root itself

```ts
const box = await makeTmpBox();
await fs.mkdir(box.path(".git/objects"), { recursive: true });
const checks = await runHealthChecks(box.root);
JSON.stringify(gitWritableCheck(checks))
=> {"name":"git-writable","ok":true,"message":".git/objects is writable","severity":"error"}
```

```ts cleanup
await box.cleanup();
```

## v2 box: `.git/objects` lives at the PACKAGE root, one level above `content/`

A `.git/objects` sitting inside `content/` (the legacy location) must NOT
satisfy the check — only the package root's `.git` counts.

```ts
const box = await makeTmpBox();
await box.write("content/.cb-box", JSON.stringify({ shapeVersion: 2 }));
await box.write("package.json", JSON.stringify({ name: "my-box", dependencies: { "callback-box": "0.1.0" } }));
await fs.mkdir(box.path("content/.git/objects"), { recursive: true });
const checks = await runHealthChecks(box.path("content"));
JSON.stringify(gitWritableCheck(checks))
=> {"name":"git-writable","ok":false,"message":".git/objects is not writable — all commits will fail (run: chown -R callback:callback «*»)","severity":"error"}
```

```ts cleanup
await box.cleanup();
```

## v2 box: `.git/objects` present at the package root passes

```ts
const box = await makeTmpBox();
await box.write("content/.cb-box", JSON.stringify({ shapeVersion: 2 }));
await box.write("package.json", JSON.stringify({ name: "my-box", dependencies: { "callback-box": "0.1.0" } }));
await fs.mkdir(box.path(".git/objects"), { recursive: true });
const checks = await runHealthChecks(box.path("content"));
JSON.stringify(gitWritableCheck(checks))
=> {"name":"git-writable","ok":true,"message":".git/objects is writable","severity":"error"}
```

```ts cleanup
await box.cleanup();
```
