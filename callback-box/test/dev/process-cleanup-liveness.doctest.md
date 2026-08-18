# Process cleanup spares live agents' browsers

`bin/process-cleanup.ts` reclaims agent-browser daemons the router's pidfiles
cannot see. It stands in front of an irreversible kill, so it must spare any
daemon a live session is using — and a session is live whether it is `claude` or
`codex`, since codex is a first-class worker agent here.

The whole exercise runs against a scratch `HOME`, so every root the module
derives (worktrees, main checkout, browse cache) points at a temporary tree and
the sweep can only ever see the fake processes made here.

```ts setup
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { classifyAgentBrowser } from "../../../bin/process-cleanup.js";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd(), "..");

// Realpath: on macOS `mkdtemp` hands back a /var/folders path that `lsof`
// reports as /private/var/folders, and the liveness guard compares cwds as
// literal prefixes. Nothing under ~/src has that problem, so this is a
// property of the scratch tree, not of the code under test.
const home = await realpath(await mkdtemp(join(tmpdir(), "process-cleanup-doctest-")));
const worktreeRoot = join(home, "src/callback-worktrees");
const browseRoot = join(home, ".cache/callback-box/browse");
const fakeBin = join(home, "fakebin");
const spawned: number[] = [];

/** A long-lived process reported by `ps` under `binPath`, running in `cwd`. */
async function fakeProcess(binPath: string, cwd: string) {
  await mkdir(resolve(binPath, ".."), { recursive: true });
  // A symlink, not a copy: macOS SIGKILLs a copied platform binary (its code
  // signature no longer verifies), and `ps comm` reports the symlink path
  // anyway, which is the name the guard matches on.
  await symlink("/bin/sleep", binPath);
  // Its own process group, so the sweep's group-kill lands on it and nothing
  // else, exactly as it would for a real detached daemon.
  const child = spawn(binPath, ["60"], { cwd, detached: true, stdio: "ignore" });
  child.unref();
  spawned.push(child.pid!);
  return child.pid!;
}

/**
 * An agent-browser daemon owned by <worktreeRoot>/<worktree>. Attribution is by
 * the daemon's binary path, so its cwd is deliberately elsewhere — a real one
 * has detached to PID 1 and its cwd proves nothing.
 */
let daemonSeq = 0;
function browserFor(worktree: string) {
  return fakeProcess(
    join(worktreeRoot, worktree, `node_modules/agent-browser/bin/agent-browser-macos-arm64-${daemonSeq++}`),
    home,
  );
}

/** Write the `*.pid` file the worktree's socket dir vouches for. */
async function vouchFor(worktree: string, pid: number) {
  await mkdir(join(browseRoot, worktree, "socket"), { recursive: true });
  await writeFile(join(browseRoot, worktree, "socket/default.pid"), `${pid}\n`);
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function sweep() {
  const { stdout } = await execFileAsync(
    join(repoRoot, "node_modules/.bin/tsx"),
    [join(repoRoot, "bin/process-cleanup.ts")],
    { env: { ...process.env, HOME: home } },
  );
  return stdout;
}
```

## A live session keeps its current daemon; everything else is reclaimed

Four daemons across three worktrees, swept in one pass. `codex-wt` has a live
`codex` session and `claude-wt` a live `claude` session — both found by process
cwd, the signal that covers a managed session of either agent (a native
Claude Code reports its version as the accounting name, so the `pgrep -x claude`
this module used to rely on saw neither). `dead-wt` has nothing at all.

```ts
await mkdir(join(worktreeRoot, "codex-wt"), { recursive: true });
await mkdir(join(worktreeRoot, "claude-wt"), { recursive: true });
await fakeProcess(join(fakeBin, "codex"), join(worktreeRoot, "codex-wt"));
await fakeProcess(join(fakeBin, "claude"), join(worktreeRoot, "claude-wt"));

const codexCurrent = await browserFor("codex-wt");
const codexSuperseded = await browserFor("codex-wt");
const claudeCurrent = await browserFor("claude-wt");
const deadDaemon = await browserFor("dead-wt");
await vouchFor("codex-wt", codexCurrent);
await vouchFor("claude-wt", claudeCurrent);

const log = await sweep();
JSON.stringify({
  codexCurrent: alive(codexCurrent),
  claudeCurrent: alive(claudeCurrent),
  codexSuperseded: alive(codexSuperseded),
  deadDaemon: alive(deadDaemon),
})
=> {"codexCurrent":true,"claudeCurrent":true,"codexSuperseded":false,"deadDaemon":false}

log.includes(`spare agent-browser pid ${codexCurrent} (codex-wt, current daemon (session live))`)
=> true

log.includes(`reclaim agent-browser pid ${deadDaemon} (dead-wt, no live session)`)
=> true
```

Once that session exits, its daemon is an orphan like any other.

```ts
for (const pid of spawned) { try { process.kill(pid, "SIGKILL"); } catch { /* already reaped */ } }
const orphan = await browserFor("codex-wt");
await vouchFor("codex-wt", orphan);
await sweep();
alive(orphan)
=> false
```

## `unknown` liveness is `live`

The guard answers `none` / `live` / `unknown`, and a caller standing in front of
a kill must not read "could not tell" as "nothing is running" — that is the
fail-open shape that bit `bin/workstreams sweep` in 2026-08. So an unreadable
process table, or a liveness oracle that cannot be run at all, spares exactly
what a live session would.

```ts
JSON.stringify([
  classifyAgentBrowser("unknown", true),
  classifyAgentBrowser("unknown", false),
  classifyAgentBrowser("live", true),
  classifyAgentBrowser("none", true),
])
=> [{"kill":false,"reason":"current daemon (session unknown)"},{"kill":true,"reason":"superseded orphan (session unknown)"},{"kill":false,"reason":"current daemon (session live)"},{"kill":true,"reason":"no live session"}]
```

```ts cleanup
for (const pid of spawned) { try { process.kill(pid, "SIGKILL"); } catch { /* already reaped */ } }
await rm(home, { recursive: true, force: true });
```
