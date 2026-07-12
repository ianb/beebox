# health: engine-link and box-schemas checks

`engineHealthChecks` is the health-check family that would have caught the
2026-07 incident where every local box's engine symlink went dead after the
engine checkout was renamed: `engine-link` verifies a v2 box's
`node_modules/callback-box` resolves to a readable engine (and isn't pinned
to a transient worktree), and `box-schemas` surfaces box-local schema files
that failed to load (keep-last-good otherwise hides them).

```ts setup
import { mkdir, symlink, rm } from "node:fs/promises";
import { engineHealthChecks } from "../../src/webapp/trpc/routers/health-engine.js";
import { invalidateBoxSchemas } from "../../src/schemas/registry.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

// Hand-scaffold a v2 (package-layout) shape inside a tmp box: package root
// with a callback-box dependency, content/ as the box root.
async function scaffoldV2(box: Awaited<ReturnType<typeof makeTmpBox>>): Promise<string> {
  await box.write(
    "pkg/package.json",
    JSON.stringify({ name: "tmp-box", private: true, dependencies: { "callback-box": "^0.1.0" } }),
  );
  await box.write("pkg/content/.cb-box", JSON.stringify({ shapeVersion: 2 }));
  return box.path("pkg/content");
}

function byName(checks: Array<{ name: string }>, name: string) {
  return checks.find((c) => c.name === name);
}
```

## Healthy v2 box: engine link resolves to a readable engine

(A fake engine directory outside any `callback-worktrees` path — linking the
test's own running engine would legitimately trip the worktree-pinned
warning below whenever the suite runs from a worktree.)

```ts
const box = await makeTmpBox();
const boxRoot = await scaffoldV2(box);
await box.write(
  "engines/main/callback-box/package.json",
  JSON.stringify({ name: "callback-box", version: "9.9.9" }),
);
await mkdir(box.path("pkg/node_modules"), { recursive: true });
await symlink(box.path("engines/main/callback-box"), box.path("pkg/node_modules/callback-box"));

const healthy = await engineHealthChecks(boxRoot);
const link = byName(healthy, "engine-link");
link?.ok
=> true

link?.message
=> engine dependency resolves (callback-box 9.9.9)

byName(healthy, "box-schemas")?.ok
=> true
```

## Dead engine symlink: error naming the target and the repair

The incident shape — the link's target checkout was renamed away.

```ts continue
await rm(box.path("pkg/node_modules/callback-box"));
await symlink(box.path("nonexistent-checkout/callback-box"), box.path("pkg/node_modules/callback-box"));

const dead = await engineHealthChecks(boxRoot);
const deadLink = byName(dead, "engine-link");
deadLink?.ok
=> false

deadLink?.severity
=> error

deadLink?.message.includes("dead symlink")
=> true

deadLink?.message.includes("nonexistent-checkout")
=> true
```

## Worktree-pinned engine link: warning (it dies with the worktree)

A resolvable link that points into a `callback-worktrees` checkout, on a box
that is not itself a worktree clone — how test1 broke in the incident.

```ts continue
await box.write(
  "callback-worktrees/some-feature/callback-box/package.json",
  JSON.stringify({ name: "callback-box", version: "0.1.0" }),
);
await rm(box.path("pkg/node_modules/callback-box"));
await symlink(box.path("callback-worktrees/some-feature/callback-box"), box.path("pkg/node_modules/callback-box"));

const pinned = await engineHealthChecks(boxRoot);
const pinnedLink = byName(pinned, "engine-link");
pinnedLink?.ok
=> false

pinnedLink?.severity
=> warning

pinnedLink?.message.includes("points into a worktree")
=> true
```

## Broken box-local schema file: box-schemas error names the file

```ts continue
await box.write("pkg/src/schemas/widget.ts", "import { nope } from \"./does-not-exist.js\";\n");
// The registry caches per-box schema snapshots; in the server a change
// trigger invalidates on schema edits, so the doctest does the same.
invalidateBoxSchemas(boxRoot);
const withBroken = await engineHealthChecks(boxRoot);
const schemas = byName(withBroken, "box-schemas");
schemas?.ok
=> false

schemas?.severity
=> error

schemas?.message.includes("widget.ts")
=> true
```

```ts cleanup
await box.cleanup();
```
