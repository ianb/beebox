# Workstream cull records

Removal captures the branch tip before moving the worktree away. The recorded
SHA is sufficient to recreate the exact tree later, while a merged verdict is
kept distinct from forced removal.

```ts setup
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd(), "..");
const teardownLib = join(repoRoot, "bin/lib/worktree-teardown.sh");

async function git(cwd: string, ...args: string[]) {
  return execFileAsync("git", args, { cwd });
}
```

## A merged removal records a recreatable final SHA

```ts
const root = await mkdtemp(join(tmpdir(), "workstream-cull-doctest-"));
const mono = join(root, "mono");
const worktreeRoot = join(root, "worktrees");
const worktree = join(worktreeRoot, "cull-fixture");
const stateDir = join(root, "state");
await execFileAsync("mkdir", ["-p", mono, worktreeRoot]);
await git(mono, "init", "-b", "main");
await git(mono, "config", "user.email", "test@example.com");
await git(mono, "config", "user.name", "Cull Test");
await execFileAsync("bash", ["-c", 'printf content > "$1/file.txt"', "fixture", mono]);
await git(mono, "add", "file.txt");
await git(mono, "commit", "-m", "fixture");
await git(mono, "worktree", "add", "-b", "worktree-cull-fixture", worktree, "main");
const finalSha = (await git(worktree, "rev-parse", "HEAD")).stdout.trim();

const removeScript = [
  '. "$1"',
  'WT_MONO="$2"',
  'WT_ROOT="$3"',
  'WT_BOX_ROOT="$4"',
  'WT_STATE_DIR="$5"',
  'WT_LOG_FILE="$5/worktree-cleanup.log"',
  'WT_AHEAD=0',
  'WT_DIRTY=0',
  'wt_remove_now "$6" worktree-cull-fixture',
].join("; ");
await execFileAsync("bash", ["-c", removeScript, "cull-test", teardownLib, mono, worktreeRoot, join(root, "boxes"), stateDir, worktree]);
const record = JSON.parse(await readFile(join(stateDir, "workstreams/cull-fixture.json"), "utf8"));
JSON.stringify({ finalSha: record.removed.finalSha === finalSha, merged: record.removed.merged })
=> {"finalSha":true,"merged":true}

const recreated = join(worktreeRoot, "recreated");
await git(mono, "worktree", "add", "-b", "worktree-recreated", recreated, record.removed.finalSha);
(await readFile(join(recreated, "file.txt"), "utf8"))
=> content

const dirty = join(worktreeRoot, "dirty-fixture");
await git(mono, "worktree", "add", "-b", "worktree-dirty-fixture", dirty, "main");
const dirtyScript = [
  '. "$1"',
  'WT_MONO="$2"',
  'WT_ROOT="$3"',
  'WT_BOX_ROOT="$4"',
  'WT_STATE_DIR="$5"',
  'WT_LOG_FILE="$5/worktree-cleanup.log"',
  'WT_AHEAD=0',
  'WT_DIRTY=1',
  'wt_remove_now "$6" worktree-dirty-fixture',
].join("; ");
await execFileAsync("bash", ["-c", dirtyScript, "cull-test", teardownLib, mono, worktreeRoot, join(root, "boxes"), stateDir, dirty]);
const dirtyRecord = JSON.parse(await readFile(join(stateDir, "workstreams/dirty-fixture.json"), "utf8"));
dirtyRecord.removed.merged
=> false
```

```ts cleanup
await rm(root, { recursive: true, force: true });
```

## Managed Claude has a cwd-independent liveness marker

The managed `--name <workstream>` argument is a second signal in front of
destructive sweep. It remains live even if the process cwd cannot be associated
with the worktree; a longer neighboring name does not collide.

```ts
const livenessScript = [
  '. "$1"',
  'WT_SNAP_STATE=ok',
  'WT_SNAP_ARGS="123 /usr/local/bin/claude --name seam --model opus"',
  'WT_SNAP_CWDS="/unrelated"',
  'wt_other_agent_live /tmp/seam',
  'printf "%s|%s" "$WT_AGENT_STATE" "$WT_AGENT_REASON"',
].join("; ");
(await execFileAsync("bash", ["-c", livenessScript, "liveness", teardownLib])).stdout
=> live|signal=argv pid=123

const neighborScript = [
  '. "$1"',
  'WT_SNAP_STATE=ok',
  'WT_SNAP_ARGS="123 /usr/local/bin/claude --name seam-other --model opus"',
  'WT_SNAP_CWDS="/unrelated"',
  'wt_other_agent_live /tmp/seam',
  'printf "%s" "$WT_AGENT_STATE"',
].join("; ");
(await execFileAsync("bash", ["-c", neighborScript, "liveness", teardownLib])).stdout
=> none
```

## A launch lease bridges the process-observation gap

The existing process signals keep precedence. When they prove no agent exists,
an active registry lease reports `launching`; expired leases stop blocking and
malformed leases fail closed.

```ts continue
const leaseStateDir = await mkdtemp(join(tmpdir(), "workstream-launch-lease-doctest-"));
await execFileAsync("bash", ["-c", '. "$1"; session_registry_begin_launch seam token-a', "lease", join(repoRoot, "bin/lib/session-registry.sh")], {
  env: { ...process.env, BBX_STATE_DIR: leaseStateDir },
});
const launchLeaseScript = [
  '. "$1"',
  'WT_SNAP_STATE="no-agents"',
  'wt_other_agent_live /tmp/seam',
  'printf "%s|%s" "$WT_AGENT_STATE" "$WT_AGENT_REASON"',
].join("; ");
(await execFileAsync("bash", ["-c", launchLeaseScript, "lease", teardownLib], {
  env: { ...process.env, BBX_STATE_DIR: leaseStateDir },
})).stdout
=> launching|signal=launch-lease

const processWinsScript = [
  '. "$1"',
  'WT_SNAP_STATE="ok"',
  'WT_SNAP_ARGS="123 /usr/local/bin/claude --name seam --model opus"',
  'WT_SNAP_CWDS="/unrelated"',
  'wt_other_agent_live /tmp/seam',
  'printf "%s|%s" "$WT_AGENT_STATE" "$WT_AGENT_REASON"',
].join("; ");
(await execFileAsync("bash", ["-c", processWinsScript, "lease", teardownLib], {
  env: { ...process.env, BBX_STATE_DIR: leaseStateDir },
})).stdout
=> live|signal=argv pid=123

await execFileAsync("bash", ["-c", `. "$1"; session_registry_merge seam '{"launch":{"token":"old","startedAt":"2026-01-01T00:00:00Z"}}'`, "lease", join(repoRoot, "bin/lib/session-registry.sh")], {
  env: { ...process.env, BBX_STATE_DIR: leaseStateDir },
});
(await execFileAsync("bash", ["-c", launchLeaseScript, "lease", teardownLib], {
  env: { ...process.env, BBX_STATE_DIR: leaseStateDir },
})).stdout
=> none|launch=expired

await execFileAsync("bash", ["-c", `. "$1"; session_registry_merge seam '{"launch":null}'; session_registry_merge seam '{"launch":{"token":"broken"}}'`, "lease", join(repoRoot, "bin/lib/session-registry.sh")], {
  env: { ...process.env, BBX_STATE_DIR: leaseStateDir },
});
(await execFileAsync("bash", ["-c", launchLeaseScript, "lease", teardownLib], {
  env: { ...process.env, BBX_STATE_DIR: leaseStateDir },
})).stdout
=> unknown|invalid-launch-record
```

```ts cleanup
await rm(leaseStateDir, { recursive: true, force: true });
```

## A failed trash move preserves the registered worktree and branch

Removal stops immediately when the worktree directory cannot move into trash.
It must not prune the registration or delete the branch after that failure.

```ts
const failureRoot = await mkdtemp(join(tmpdir(), "workstream-cull-failure-doctest-"));
const failureMono = join(failureRoot, "mono");
const failureWorktree = join(failureRoot, "worktrees/failure-fixture");
const failureState = join(failureRoot, "state");
await execFileAsync("mkdir", ["-p", failureMono, join(failureRoot, "worktrees"), failureState]);
await git(failureMono, "init", "-b", "main");
await git(failureMono, "config", "user.email", "test@example.com");
await git(failureMono, "config", "user.name", "Cull Test");
await execFileAsync("bash", ["-c", 'printf content > "$1/file.txt"', "fixture", failureMono]);
await git(failureMono, "add", "file.txt");
await git(failureMono, "commit", "-m", "fixture");
await git(failureMono, "worktree", "add", "-b", "worktree-failure-fixture", failureWorktree, "main");
const failureScript = [
  '. "$1"',
  'WT_MONO="$2"',
  'WT_ROOT="$3"',
  'WT_BOX_ROOT="$4"',
  'WT_STATE_DIR="$5"',
  'WT_LOG_FILE="$5/worktree-cleanup.log"',
  'WT_AHEAD=0',
  'WT_DIRTY=0',
  'FAIL_PATH="$7"',
  'GIT_CALLS="$6/git-calls"',
  'mv() { if [ "$1" = "$FAIL_PATH" ]; then echo "simulated move failure" >&2; return 1; fi; command mv "$@"; }',
  'git() { if { [ "$1" = worktree ] && [ "$2" = prune ]; } || { [ "$1" = branch ] && [ "$2" = -D ]; }; then printf "%s %s\n" "$1" "$2" >> "$GIT_CALLS"; fi; command git "$@"; }',
  'wt_remove_now "$7" worktree-failure-fixture',
].join("; ");
const failure = await execFileAsync("bash", ["-c", failureScript, "failure-test", teardownLib, failureMono, join(failureRoot, "worktrees"), join(failureRoot, "boxes"), failureState, failureRoot, failureWorktree])
  .catch((error: unknown) => error as { code: number; stderr: string });
const registered = (await git(failureMono, "worktree", "list", "--porcelain")).stdout.includes("branch refs/heads/worktree-failure-fixture");
const branchExists = await git(failureMono, "show-ref", "--verify", "refs/heads/worktree-failure-fixture")
  .then(() => true, () => false);
const cleanupCalls = await readFile(join(failureRoot, "git-calls"), "utf8").catch(() => "");
JSON.stringify({ code: failure.code, registered, branchExists, cleanupSkipped: cleanupCalls === "", reported: failure.stdout.includes("refusing branch cleanup") })
=> {"code":1,"registered":true,"branchExists":true,"cleanupSkipped":true,"reported":true}
```

```ts cleanup
await rm(failureRoot, { recursive: true, force: true });
```
