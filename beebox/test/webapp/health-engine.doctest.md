# health: engine-link and box-schemas checks

`engineHealthChecks` is the health-check family that would have caught the
2026-07 incident where every local box's engine symlink went dead after the
engine checkout was renamed: `engine-link` verifies a box's
`node_modules/beebox` resolves to a readable engine (and isn't pinned
to a transient worktree), and `box-schemas` surfaces box-local schema files
that failed to load (keep-last-good otherwise hides them).

```ts setup
import { mkdir, symlink, rm, unlink, writeFile } from "node:fs/promises";
import { engineHealthChecks } from "../../src/webapp/trpc/routers/health-engine.js";
import { invalidateBoxSchemas } from "../../src/schemas/registry.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

// Hand-scaffold a v3 (one-root) shape inside a tmp box: package.json
// declaring a beebox dependency and the marker, both at the same root.
async function scaffoldV3(box: Awaited<ReturnType<typeof makeTmpBox>>): Promise<string> {
  await box.write(
    "pkg/package.json",
    JSON.stringify({ name: "tmp-box", private: true, dependencies: { "beebox": "^0.1.0" } }),
  );
  await box.write("pkg/.beebox/box.json", JSON.stringify({ shapeVersion: 3 }));
  return box.path("pkg");
}

function byName(checks: Array<{ name: string }>, name: string) {
  return checks.find((c) => c.name === name);
}
```

## Healthy v3 box: engine link resolves to a readable engine

(A fake engine directory outside any `beebox-worktrees` path — linking the
test's own running engine would legitimately trip the worktree-pinned
warning below whenever the suite runs from a worktree.)

```ts
const box = await makeTmpBox();
const boxRoot = await scaffoldV3(box);
await box.write(
  "engines/main/beebox/package.json",
  JSON.stringify({ name: "beebox", version: "9.9.9" }),
);
await mkdir(box.path("pkg/node_modules"), { recursive: true });
await symlink(box.path("engines/main/beebox"), box.path("pkg/node_modules/beebox"));

const healthy = await engineHealthChecks(boxRoot);
const link = byName(healthy, "engine-link");
link?.ok
=> true

link?.message
=> engine dependency resolves (beebox 9.9.9)

byName(healthy, "box-schemas")?.ok
=> true
```

## Dead engine symlink: error naming the target and the repair

The incident shape — the link's target checkout was renamed away.

```ts continue
await rm(box.path("pkg/node_modules/beebox"));
await symlink(box.path("nonexistent-checkout/beebox"), box.path("pkg/node_modules/beebox"));

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

A resolvable link that points into a `beebox-worktrees` checkout, on a box
that is not itself a worktree clone — how test1 broke in the incident.

```ts continue
await box.write(
  "beebox-worktrees/some-feature/beebox/package.json",
  JSON.stringify({ name: "beebox", version: "0.1.0" }),
);
await rm(box.path("pkg/node_modules/beebox"));
await symlink(box.path("beebox-worktrees/some-feature/beebox"), box.path("pkg/node_modules/beebox"));

const pinned = await engineHealthChecks(boxRoot);
const pinnedLink = byName(pinned, "engine-link");
pinnedLink?.ok
=> false

pinnedLink?.severity
=> warning

pinnedLink?.message.includes("points into a worktree")
=> true

await unlink(box.path("pkg/node_modules/beebox"));
await mkdir(box.path("callback-worktrees/old-feature/beebox"), { recursive: true });
await writeFile(box.path("callback-worktrees/old-feature/beebox/package.json"), JSON.stringify({ name: "beebox", version: "0.1.0" }));
await symlink(box.path("callback-worktrees/old-feature/beebox"), box.path("pkg/node_modules/beebox"));

(await engineHealthChecks(boxRoot)).find((c) => c.name === "engine-link")?.ok
=> false
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
