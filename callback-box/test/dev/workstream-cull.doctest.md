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
