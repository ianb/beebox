# `bbx upgrade` — orchestration + the Ghost-lesson revert (Track E)

`runUpgrade` composes existing machinery (`git`, `pnpm install`, the box's own
`bbx migrate`/`bbx init`/`tsc`) behind a single `runCommand` injection point —
see the module doc comment in `src/cli/commands/upgrade.ts`. Everything else
(the git snapshot, the working tree, `package.json`, `node_modules/`) is
real: these doctests exercise a real git repo in a temp dir with a fake
`runCommand` standing in for pnpm/the new engine's subprocesses, so the
revert path's real effect (working tree back to the snapshot, previous
engine "reinstalled") can be observed directly rather than asserted about a
mock. All the fake-runner logic lives here in setup (module scope) — example
blocks stay to single calls + assertions, per `.claude/rules/doctest.md`.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { runUpgrade, UpgradeStepFailedError, DirtyWorkingTreeError } from "../../../src/cli/commands/upgrade.js";
import { BoxShapeError } from "../../../src/lib/box-shape.js";
import { getStatus, getHead, getLog } from "../../../src/lib/git.js";

const OLD_VERSION = "0.1.0";
const NEW_VERSION = "0.2.0";

async function writeInstalledVersion(boxRoot, version) {
  await fs.mkdir(path.join(boxRoot, "node_modules/beebox"), { recursive: true });
  await fs.writeFile(
    path.join(boxRoot, "node_modules/beebox/package.json"),
    JSON.stringify({ version }),
  );
}

async function readInstalledVersion(boxRoot) {
  const raw = await fs.readFile(path.join(boxRoot, "node_modules/beebox/package.json"), "utf-8");
  return JSON.parse(raw).version;
}

async function readPinnedSpec(boxRoot) {
  const raw = await fs.readFile(path.join(boxRoot, "package.json"), "utf-8");
  return JSON.parse(raw).dependencies["beebox"];
}

/** A real git repo shaped like a shapeVersion-3 box: `.beebox/box.json`,
 *  package.json pinning beebox, and a (gitignored, like a real box)
 *  node_modules/beebox/package.json standing in for the installed
 *  engine. */
async function makeV3Fixture() {
  const boxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-upgrade-fixture-"));
  await fs.mkdir(path.join(boxRoot, ".beebox"), { recursive: true });
  await fs.writeFile(path.join(boxRoot, ".beebox/box.json"), JSON.stringify({ shapeVersion: 3 }));
  // Real boxes gitignore .beebox/ at the box root (box.ts's own
  // .gitignore template) — without it, the revert's log write below would
  // read as working-tree dirt and fail the "clean again" assertion for a
  // reason that isn't the thing under test.
  await fs.writeFile(
    path.join(boxRoot, "package.json"),
    JSON.stringify({ name: "fixture-box", dependencies: { "beebox": OLD_VERSION } }, null, 2),
  );
  await writeInstalledVersion(boxRoot, OLD_VERSION);
  // node_modules is gitignored, same as a real box (scaffoldBoxRoot's
  // ROOT_GITIGNORE) — a real `pnpm install` isn't tracked, so reverting it
  // is the fake "pnpm-install-restore" step's job, not git's.
  await fs.writeFile(path.join(boxRoot, ".gitignore"), ".beebox/\nnode_modules/\n");
  execSync("git init -q -b main && git add -A && git commit -q -m init", { cwd: boxRoot });
  return boxRoot;
}

/** A fake `runCommand`: records every step's label in `calls`, simulates
 *  `pnpm install` resolving `NEW_VERSION` and `pnpm-install-restore`
 *  reverting to `OLD_VERSION` (the two steps with a real filesystem side
 *  effect in production), and fails the step named in `failLabel` (if any)
 *  with `failOutput`. */
function makeFakeRunner({ boxRoot, calls, failLabel, failOutput }) {
  return async ({ label }) => {
    calls.push(label);
    if (label === failLabel) return { code: 1, output: failOutput };
    if (label === "pnpm-install") await writeInstalledVersion(boxRoot, NEW_VERSION);
    if (label === "pnpm-install-restore") await writeInstalledVersion(boxRoot, OLD_VERSION);
    return { code: 0, output: "" };
  };
}

async function tryUpgrade(boxRoot, runCommand, startPath) {
  startPath = startPath ?? boxRoot;
  try {
    return await runUpgrade({ to: NEW_VERSION }, { runCommand, startPath });
  } catch (e) {
    return e;
  }
}
```

## Happy path: every step runs in order, the commit carries the trailer

```ts
const boxRoot = await makeV3Fixture();
const calls = [];
const runCommand = makeFakeRunner({ boxRoot, calls });
const result = await tryUpgrade(boxRoot, runCommand);
result.installedVersion
=> 0.2.0

JSON.stringify(calls)
=> ["preflight-validate","pnpm-install","bbx-migrate","bbx-init","tsc"]
```

The commit carries the `Upgraded-To` trailer with the ACTUALLY-installed
version (read from `node_modules/beebox/package.json`), not the
`--to` spec string:

```ts continue
const log = await getLog(boxRoot, 1);
JSON.stringify(log[0].trailers)
=> {"Upgraded-To":"beebox@0.2.0"}
```

```ts cleanup
await fs.rm(boxRoot, { recursive: true, force: true });
```

## Revert on failure: code + data revert as ONE unit (the Ghost lesson)

`bbx-migrate` fails partway through. The revert path must: `git reset --hard`
the box root (undoing the `package.json` dependency bump), re-run
`pnpm install` to restore the previous engine, log the failure, and leave the
box in EXACTLY its pre-upgrade state — not just its pre-upgrade commit.

```ts
const boxRoot = await makeV3Fixture();
const snapshotSha = await getHead(boxRoot);
const calls = [];
const runCommand = makeFakeRunner({ boxRoot, calls, failLabel: "bbx-migrate", failOutput: "boom: migration blew up" });
const thrown = await tryUpgrade(boxRoot, runCommand);
thrown instanceof UpgradeStepFailedError
=> true

JSON.stringify(calls)
=> ["preflight-validate","pnpm-install","bbx-migrate","pnpm-install-restore"]
```

The dependency bump is gone (`package.json` reverted by `git reset --hard`),
and the previous engine is back (the fake restore step's write, standing in
for a real `pnpm install`):

```ts continue
await readPinnedSpec(boxRoot)
=> 0.1.0

await readInstalledVersion(boxRoot)
=> 0.1.0
```

HEAD never moved (nothing had been committed yet) and the working tree is
clean again — the revert leaves no trace of the attempt in the tracked tree:

```ts continue
(await getHead(boxRoot)) === snapshotSha
=> true
```

```ts continue
const status = await getStatus(boxRoot);
status.clean
=> true
```

The failure is logged to `.beebox/logs/upgrade.log`:

```ts continue
const logText = await fs.readFile(path.join(boxRoot, ".beebox/logs/upgrade.log"), "utf-8");
logText.includes("boom: migration blew up")
=> true
```

```ts cleanup
await fs.rm(boxRoot, { recursive: true, force: true });
```

## Revert removes untracked files a failed step left behind

`git reset --hard` alone only reverts TRACKED changes. If the failing step
(here `bbx-migrate`) also scaffolds a new, never-tracked file before failing —
the shape a real template/migration write would take — the revert must also
remove it, or "box restored to pre-upgrade state" is false.

```ts
const boxRoot = await makeV3Fixture();
const calls = [];
const runCommand = async ({ label }) => {
  calls.push(label);
  if (label === "bbx-migrate") {
    await fs.writeFile(path.join(boxRoot, "untracked-scaffold.txt"), "junk");
    return { code: 1, output: "boom: migration blew up" };
  }
  if (label === "pnpm-install") await writeInstalledVersion(boxRoot, NEW_VERSION);
  if (label === "pnpm-install-restore") await writeInstalledVersion(boxRoot, OLD_VERSION);
  return { code: 0, output: "" };
};
const thrown = await tryUpgrade(boxRoot, runCommand);
thrown instanceof UpgradeStepFailedError
=> true
```

The untracked file is gone, and the working tree reads clean again — not
just "no tracked diff", but genuinely restored:

```ts continue
const scaffoldExists = await fs.access(path.join(boxRoot, "untracked-scaffold.txt")).then(() => true, () => false);
scaffoldExists
=> false

const status = await getStatus(boxRoot);
status.clean
=> true
```

```ts cleanup
await fs.rm(boxRoot, { recursive: true, force: true });
```

## A step failing AFTER a successful revert-relevant step still reverts everything

Same as above, but the failure happens at `tsc` (after migrate and init both
"succeeded") — the whole batch still reverts as one unit, not just the last step:

```ts
const boxRoot = await makeV3Fixture();
const calls = [];
const runCommand = makeFakeRunner({ boxRoot, calls, failLabel: "tsc", failOutput: "type error" });
const thrown = await tryUpgrade(boxRoot, runCommand);
thrown instanceof UpgradeStepFailedError
=> true

await readPinnedSpec(boxRoot)
=> 0.1.0

await readInstalledVersion(boxRoot)
=> 0.1.0
```

```ts cleanup
await fs.rm(boxRoot, { recursive: true, force: true });
```

## A dirty working tree refuses to start (nothing to snapshot against)

```ts
const boxRoot = await makeV3Fixture();
await fs.writeFile(path.join(boxRoot, "README.md"), "uncommitted\n");
const thrown = await tryUpgrade(boxRoot, makeFakeRunner({ boxRoot, calls: [] }));
thrown instanceof DirtyWorkingTreeError
=> true
```

```ts cleanup
await fs.rm(boxRoot, { recursive: true, force: true });
```

## A box that predates the one-root layout refuses with a clear error

```ts
const legacyRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-upgrade-legacy-"));
await fs.mkdir(path.join(legacyRoot, ".beebox"), { recursive: true });
await fs.writeFile(path.join(legacyRoot, ".beebox/box.json"), "");
execSync("git init -q -b main && git add -A && git commit -q -m init --allow-empty", { cwd: legacyRoot });
const thrown = await tryUpgrade(legacyRoot, makeFakeRunner({ boxRoot: legacyRoot, calls: [] }), legacyRoot);
thrown instanceof BoxShapeError
=> true
```

```ts cleanup
await fs.rm(legacyRoot, { recursive: true, force: true });
```
