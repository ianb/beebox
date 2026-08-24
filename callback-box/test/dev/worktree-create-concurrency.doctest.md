# Concurrent worktree creation

Git worktree attachment is repository-global, while setup is independent by
workstream name. The launcher serializes only those respective scopes and uses
kernel-owned locks that disappear with their holder process.

```ts setup
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(process.cwd(), "..");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "worktree-create-concurrency-"));
const mono = path.join(root, "mono");
const worktrees = path.join(root, "worktrees");
const binDir = path.join(root, "test-bin");
const markerDir = path.join(root, "markers");
const release = path.join(root, "release");
const calls = path.join(root, "pnpm-calls");
const observerDir = path.join(root, "lock-observers");

await fs.mkdir(path.join(mono, "bin/lib"), { recursive: true });
await fs.mkdir(path.join(mono, "callback-box"));
for (const file of [
  "comments-store.sh",
  "exhibits-store.sh",
  "session-registry.sh",
  "worktree-create.sh",
  "worktree-git-lock.sh",
  "worktree-paths.sh",
  "worktree-teardown.sh",
]) {
  await fs.copyFile(path.join(repoRoot, "bin/lib", file), path.join(mono, "bin/lib", file));
}
await fs.writeFile(path.join(mono, "callback-box/fixture"), "fixture\n");
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: mono });
execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: mono });
execFileSync("git", ["config", "user.name", "Test"], { cwd: mono });
execFileSync("git", ["add", "."], { cwd: mono });
execFileSync("git", ["commit", "-qm", "fixture"], { cwd: mono });
await fs.mkdir(binDir);
await fs.mkdir(markerDir);

const createLib = path.join(mono, "bin/lib/worktree-create.sh");
const lockLib = path.join(mono, "bin/lib/worktree-git-lock.sh");
const teardownLib = path.join(mono, "bin/lib/worktree-teardown.sh");
const baseEnv = {
  ...process.env,
  PATH: `${binDir}:${process.env.PATH ?? ""}`,
  CALLBACK_WORKTREE_ROOT: worktrees,
  CALLBACK_BOX_ROOT: path.join(root, "box-worktrees"),
  CALLBACK_BOX_SRC: path.join(root, "missing-source-box"),
  CALLBACK_EXHIBITS_ROOT: path.join(root, "exhibits"),
  CALLBACK_COMMENTS_ROOT: path.join(root, "comments"),
  CALLBACK_STATE_DIR: path.join(root, "state"),
  SETUP_MARKERS: markerDir,
  SETUP_RELEASE: release,
  SETUP_CALLS: calls,
  WT_GIT_LOCK_OBSERVER_DIR: observerDir,
};

interface ProcessResult { code: number | null; stderr: string }
function create(name: string, extraEnv: NodeJS.ProcessEnv = {}) {
  const child = spawn("bash", ["-c", 'set -euo pipefail; . "$1"; wt_create "$2" main', "create-test", createLib, name], {
    env: { ...baseEnv, ...extraEnv },
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const done = new Promise<ProcessResult>((resolveDone) => {
    child.on("exit", (code) => resolveDone({ code, stderr }));
  });
  return { child, done };
}

function removeWorktree(name: string) {
  const worktree = path.join(worktrees, name);
  const child = spawn("bash", ["-c", [
    "set -euo pipefail",
    '. "$1"',
    "WT_AHEAD=0",
    "WT_DIRTY=0",
    'wt_remove_now "$2" "$3"',
  ].join("; "), "remove-test", teardownLib, worktree, `worktree-${name}`], {
    env: { ...baseEnv, ROUTER_PORT: "1" },
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const done = new Promise<ProcessResult>((resolveDone) => {
    child.on("exit", (code) => resolveDone({ code, stderr }));
  });
  return { child, done };
}

async function exists(file: string): Promise<boolean> {
  return fs.stat(file).then(() => true, () => false);
}

async function waitFor(file: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await exists(file))) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${file}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}

async function writePnpm(wait: boolean): Promise<void> {
  const body = [
    "#!/bin/sh",
    'name=${PWD##*/}',
    'printf "%s\\n" "$name" >> "$SETUP_CALLS"',
    'mkdir -p "$SETUP_MARKERS"',
    ': > "$SETUP_MARKERS/$name"',
    'if [ "${SETUP_FAIL_NAME:-}" = "$name" ]; then exit 42; fi',
    ...(wait ? ['while [ ! -f "$SETUP_RELEASE" ]; do sleep 0.01; done'] : []),
  ].join("\n");
  const pnpm = path.join(binDir, "pnpm");
  await fs.writeFile(pnpm, `${body}\n`);
  await fs.chmod(pnpm, 0o755);
}

async function runBurst(): Promise<number> {
  await writePnpm(false);
  const burstNames = Array.from({ length: 24 }, (_, index) => `burst-${index + 1}`);
  const burst = burstNames.map((name) => create(name));
  const burstResults = await Promise.all(burst.map(({ done }) => done));
  assert.deepEqual(burstResults.map(({ code }) => code), burstNames.map(() => 0));
  const porcelain = execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd: mono,
    encoding: "utf8",
  });
  for (const name of burstNames) {
    assert.match(porcelain, new RegExp(`worktree .*/${name}\\nHEAD [0-9a-f]+\\nbranch refs/heads/worktree-${name}\\n`));
  }
  return burstNames.length;
}

async function repairInterruptedSetup(): Promise<{ code: number | null; setupRan: boolean; stateReady: boolean }> {
  const name = "interrupted";
  const worktree = path.join(worktrees, name);
  execFileSync("git", ["worktree", "add", "-q", "-b", `worktree-${name}`, worktree, "main"], { cwd: mono });
  const stateFile = path.join(mono, ".git", `callback-worktree-setup-${name}.state`);
  await fs.writeFile(stateFile, `in-progress\t${worktree}\n`);
  const repaired = create(name);
  const result = await repaired.done;
  const setupCalls = (await fs.readFile(calls, "utf8")).trim().split("\n");
  return {
    code: result.code,
    setupRan: setupCalls.includes(name),
    stateReady: (await fs.readFile(stateFile, "utf8")).startsWith("ready\t"),
  };
}

async function failThenRepair(): Promise<{ failed: number | null; incomplete: boolean; retried: number | null; ready: boolean }> {
  const name = "failed-setup";
  const failed = await create(name, { SETUP_FAIL_NAME: name }).done;
  const stateFile = path.join(mono, ".git", `callback-worktree-setup-${name}.state`);
  const incomplete = (await fs.readFile(stateFile, "utf8")).startsWith("in-progress\t");
  const retried = await create(name).done;
  return {
    failed: failed.code,
    incomplete,
    retried: retried.code,
    ready: (await fs.readFile(stateFile, "utf8")).startsWith("ready\t"),
  };
}

async function legacyBackfill(): Promise<{ code: number | null; envPreserved: boolean; setupSkipped: boolean; ready: boolean }> {
  const name = "legacy";
  const worktree = path.join(worktrees, name);
  execFileSync("git", ["worktree", "add", "-q", "-b", `worktree-${name}`, worktree, "main"], { cwd: mono });
  const localEnv = path.join(worktree, "callback-box/.env");
  await fs.writeFile(localEnv, "LOCAL_ONLY=1\n");
  const beforeCalls = await fs.readFile(calls, "utf8");
  const result = await create(name).done;
  const afterCalls = await fs.readFile(calls, "utf8");
  const stateFile = path.join(mono, ".git", `callback-worktree-setup-${name}.state`);
  return {
    code: result.code,
    envPreserved: (await fs.readFile(localEnv, "utf8")) === "LOCAL_ONLY=1\n",
    setupSkipped: beforeCalls === afterCalls,
    ready: (await fs.readFile(stateFile, "utf8")).startsWith("ready\t"),
  };
}

async function createThenRemove(): Promise<{ create: number | null; firstRemoveRefused: boolean; survivedUntilRelease: boolean; retryRemove: number | null; removed: boolean }> {
  const name = "remove-race";
  await writePnpm(true);
  await fs.rm(release, { force: true });
  const creator = create(name);
  await waitFor(path.join(markerDir, name));
  const firstRemover = removeWorktree(name);
  await waitFor(path.join(observerDir, `callback-worktree-setup-${name}.lock.waiting`));
  const firstRemoveResult = await firstRemover.done;
  const survivedUntilRelease = await exists(path.join(worktrees, name));
  await fs.writeFile(release, "release\n");
  const createResult = await creator.done;
  const retryResult = await removeWorktree(name).done;
  return {
    create: createResult.code,
    firstRemoveRefused: firstRemoveResult.code !== 0,
    survivedUntilRelease,
    retryRemove: retryResult.code,
    removed: !(await exists(path.join(worktrees, name))),
  };
}

async function repairDanglingRegistration(): Promise<{ code: number | null; pathRestored: boolean; correctBranch: boolean }> {
  const name = "dangling";
  const worktree = path.join(worktrees, name);
  const moved = path.join(root, "moved-dangling");
  execFileSync("git", ["worktree", "add", "-q", "-b", `worktree-${name}`, worktree, "main"], { cwd: mono });
  await fs.rename(worktree, moved);
  const result = await create(name).done;
  const porcelain = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: mono, encoding: "utf8" });
  return {
    code: result.code,
    pathRestored: await exists(worktree),
    correctBranch: new RegExp(`worktree .*/${name}\\nHEAD [0-9a-f]+\\nbranch refs/heads/worktree-${name}\\n`).test(porcelain),
  };
}

async function nativeRemovalTombstone(): Promise<{ refusedWhileRegistered: boolean; recreatedAfterRemoval: boolean }> {
  const name = "native-removal";
  const worktree = path.join(worktrees, name);
  execFileSync("git", ["worktree", "add", "-q", "-b", `worktree-${name}`, worktree, "main"], { cwd: mono });
  const canonicalWorktree = path.join(await fs.realpath(worktrees), name);
  const stateFile = path.join(mono, ".git", `callback-worktree-setup-${name}.state`);
  await fs.writeFile(stateFile, `native-removal-pending\t${canonicalWorktree}\n`);
  const refused = await create(name).done;
  execFileSync("git", ["worktree", "remove", "--force", worktree], { cwd: mono });
  const recreated = await create(name).done;
  return {
    refusedWhileRegistered: refused.code !== 0,
    recreatedAfterRemoval: recreated.code === 0,
  };
}
```

## Same-name callers wait for completed setup

The first creator pauses in pnpm after Git has registered the checkout. The
second reaches actual lock contention, not just a timer, and cannot return the
half-configured checkout. Once released it takes the completed resume path, so
setup ran exactly once.

```ts
await writePnpm(true);
const first = create("same-name");
await waitFor(path.join(markerDir, "same-name"));
const second = create("same-name");
await waitFor(path.join(observerDir, "callback-worktree-setup-same-name.lock.waiting"));
assert.equal(second.child.exitCode, null);
await fs.writeFile(release, "release\n");
const [firstResult, secondResult] = await Promise.all([first.done, second.done]);
const setupCalls = (await fs.readFile(calls, "utf8")).trim().split("\n");
assert.equal(secondResult.code, 0, secondResult.stderr);
JSON.stringify({ first: firstResult.code, second: secondResult.code, setupCalls })
=> {"first":0,"second":0,"setupCalls":["same-name"]}
```

## Different-name setup remains parallel

Both creators pass their brief repository attachment transaction and reach the
post-attachment setup barrier before either is released.

```ts continue
await fs.rm(release, { force: true });
await fs.writeFile(calls, "");
const alpha = create("alpha");
const beta = create("beta");
await Promise.all([
  waitFor(path.join(markerDir, "alpha")),
  waitFor(path.join(markerDir, "beta")),
]);
assert.equal(alpha.child.exitCode, null);
assert.equal(beta.child.exitCode, null);
await fs.writeFile(release, "release\n");
const [alphaResult, betaResult] = await Promise.all([alpha.done, beta.done]);
const parallelCalls = (await fs.readFile(calls, "utf8")).trim().split("\n").sort();
JSON.stringify({ alpha: alphaResult.code, beta: betaResult.code, parallelCalls })
=> {"alpha":0,"beta":0,"parallelCalls":["alpha","beta"]}
```

## Teardown waits for same-name setup

Removal reaches the same per-name lock while creation is paused in setup. The
checkout remains present until setup releases, then teardown completes.

```ts continue
JSON.stringify(await createThenRemove())
=> {"create":0,"firstRemoveRefused":true,"survivedUntilRelease":true,"retryRemove":0,"removed":true}
```

## A burst preserves every requested branch

The incident registered one different-name checkout on main, then made a later
add fail while trying to create main. A burst against a minimal real
repository checks every registration, not merely each process exit.

```ts continue
await runBurst()
=> 24
```

## Registration without readiness is repaired

A process can die after Git attachment but before setup finishes. A registered
checkout without the private readiness marker takes the idempotent setup path
instead of the fast resume path.

```ts continue
JSON.stringify(await repairInterruptedSetup())
=> {"code":0,"setupRan":true,"stateReady":true}
```

## Setup failure stays failed and retryable

The doctest uses the production errexit shell. A failing pnpm exits with its
status, leaves setup incomplete, and a later same-name call repairs it before
recording readiness.

```ts continue
JSON.stringify(await failThenRepair())
=> {"failed":42,"incomplete":true,"retried":0,"ready":true}
```

## Legacy checkout state is backfilled without setup

A checkout created before the state protocol has no marker. Its first resume
records readiness but preserves the checkout-local environment and skips pnpm.

```ts continue
JSON.stringify(await legacyBackfill())
=> {"code":0,"envPreserved":true,"setupSkipped":true,"ready":true}
```

## A dangling registration is pruned and reattached

If teardown was killed after moving the directory but before pruning Git's
registration, creation repairs that exact state under the admin lock.

```ts continue
JSON.stringify(await repairDanglingRegistration())
=> {"code":0,"pathRestored":true,"correctBranch":true}
```

## Native-removal tombstone blocks premature resume

The Claude adapter's tombstone refuses same-name reuse while Git still
registers the checkout. Once Claude's own removal lands, fresh creation
replaces the tombstone and succeeds.

```ts continue
JSON.stringify(await nativeRemovalTombstone())
=> {"refusedWhileRegistered":true,"recreatedAfterRemoval":true}
```

## A killed holder leaves no stale lock

The diagnostic lock file persists, but ownership belongs to the process's open
descriptor. Killing that process lets the next caller acquire immediately.

```ts continue
const holderReady = path.join(root, "holder-ready");
const holder = spawn("bash", ["-c", [
  '. "$1"',
  'WT_MONO="$2"',
  "wt_git_admin_lock_acquire",
  ': > "$3"',
  "exec sleep 60",
].join("; "), "lock-holder", lockLib, mono, holderReady], { env: baseEnv });
const holderDone = new Promise<number | null>((resolveDone) => holder.on("exit", resolveDone));
await waitFor(holderReady);
const timedOut = spawnSync("bash", ["-c", [
  '. "$1"',
  'WT_MONO="$2"',
  "WT_GIT_ADMIN_LOCK_TIMEOUT_SECONDS=1",
  "wt_git_admin_lock_acquire",
].join("; "), "lock-timeout", lockLib, mono], { env: baseEnv, encoding: "utf8" });
assert.notEqual(timedOut.status, 0);
assert.match(timedOut.stderr, /timed out after 1s/);
holder.kill("SIGKILL");
await holderDone;
const afterKill = await execFileAsync("bash", ["-c", [
  '. "$1"',
  'WT_MONO="$2"',
  "WT_GIT_ADMIN_LOCK_TIMEOUT_SECONDS=2",
  "wt_git_admin_lock_acquire",
  "printf acquired",
  "wt_git_admin_lock_release",
].join("; "), "lock-follower", lockLib, mono], { env: baseEnv });
afterKill.stdout
=> acquired
```

```ts cleanup
await fs.rm(root, { recursive: true, force: true });
```
