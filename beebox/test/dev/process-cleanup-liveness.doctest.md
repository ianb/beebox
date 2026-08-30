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

import { classifyAgentBrowser, etimeToSeconds } from "../../../bin/process-cleanup.js";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd(), "..");

// Realpath: on macOS `mkdtemp` hands back a /var/folders path that `lsof`
// reports as /private/var/folders, and the liveness guard compares cwds as
// literal prefixes. Nothing under ~/src has that problem, so this is a
// property of the scratch tree, not of the code under test.
const home = await realpath(await mkdtemp(join(tmpdir(), "process-cleanup-doctest-")));
const worktreeRoot = join(home, "src/callback-worktrees");
const browseRoot = join(home, ".cache/beebox/browse");
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

async function sweep(env: Record<string, string> = {}) {
  const { stdout } = await execFileAsync(
    join(repoRoot, "node_modules/.bin/tsx"),
    [join(repoRoot, "bin/process-cleanup.ts")],
    // Every daemon these cases make is seconds old, and an unvouched process
    // that young is spared by the starting-daemon guard (its own case below).
    // Zeroing the threshold puts the OTHER dimensions of the predicate — live
    // session, vouched pidfile — back under test.
    { env: { ...process.env, HOME: home, BBX_CLEANUP_MIN_ORPHAN_AGE_SEC: "0", ...env } },
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

log.includes(`spare agent-browser pid ${codexCurrent} (codex-wt, current daemon)`)
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

## `launching` and `unknown` liveness spare everything

The guard answers `none` / `launching` / `live` / `unknown`, and a caller
standing in front of a kill must not read setup or "could not tell" as "nothing
is running". Both uncertain states are handled harder than `live`: before the
agent boundary there is not yet a trustworthy current-daemon signal, and after
an oracle failure there is no second signal left to be wrong about.

```ts
const old = 3600;
JSON.stringify([
  classifyAgentBrowser("unknown", { vouched: true, ageSec: old }),
  classifyAgentBrowser("unknown", { vouched: false, ageSec: old }),
  classifyAgentBrowser("launching", { vouched: true, ageSec: old }),
  classifyAgentBrowser("launching", { vouched: false, ageSec: old }),
  classifyAgentBrowser("live", { vouched: true, ageSec: old }),
  classifyAgentBrowser("live", { vouched: false, ageSec: old }),
  classifyAgentBrowser("none", { vouched: true, ageSec: old }),
])
=> [{"kill":false,"reason":"session liveness unknown"},{"kill":false,"reason":"session liveness unknown"},{"kill":false,"reason":"launch in progress"},{"kill":false,"reason":"launch in progress"},{"kill":false,"reason":"current daemon"},{"kill":true,"reason":"superseded orphan"},{"kill":true,"reason":"no live session"}]
```

## A daemon too young to have written its pidfile is not an orphan

The socket dir's `*.pid` files are the only thing that vouches for a daemon, and
upstream writes them a beat after the process appears — measured at ~2 seconds
on a cold start. In that window "not vouched for" says nothing about the
process, so it cannot be read as "superseded". Two agents sharing one worktree
is enough to hit it: whichever runs second reaps the browser the first is still
starting (issues/bugs/2026-08-21-browse-reaper-kills-other-sessions-daemons.md).

Age is what closes it, and it closes it in every branch that would otherwise
kill an unvouched process — including a worktree with no session at all, where
something still spawned that daemon a moment ago.

```ts
const young = 5;
JSON.stringify([
  classifyAgentBrowser("live", { vouched: false, ageSec: young }),
  classifyAgentBrowser("none", { vouched: false, ageSec: young }),
  classifyAgentBrowser("live", { vouched: true, ageSec: young }),
  classifyAgentBrowser("live", { vouched: false, ageSec: 61 }),
])
=> [{"kill":false,"reason":"starting (5s old, no pidfile yet)"},{"kill":false,"reason":"starting (5s old, no pidfile yet)"},{"kill":false,"reason":"current daemon"},{"kill":true,"reason":"superseded orphan"}]
```

The threshold is overridable only so a test can reach the reaping half of the
predicate at all. A malformed override falls back to the default rather than
becoming `NaN`, which would lose every comparison and quietly turn the guard
off — the failure it exists to prevent.

```ts
const starting = await browserFor("dead-wt");
await sweep({ BBX_CLEANUP_MIN_ORPHAN_AGE_SEC: "not-a-number" });
alive(starting)
=> true
```

Age arrives from `ps etime`, whose field is `[[dd-]hh:]mm:ss`. An unparseable
one reads as infinitely old rather than newborn: the guard must not hand out
"too young to judge" on the strength of a field it failed to read.

```ts
JSON.stringify([
  etimeToSeconds("00:07"), etimeToSeconds("01:30"), etimeToSeconds("2:03:04"),
  etimeToSeconds("1-00:00:00"), etimeToSeconds("garbage"),
])
=> [7,90,7384,86400,null]
```

End to end: an unvouched daemon in a worktree with no session at all — the case
the sweep is most eager to reclaim — survives while it is still young.

```ts
const stillStarting = await browserFor("dead-wt");
await sweep({ BBX_CLEANUP_MIN_ORPHAN_AGE_SEC: "60" });
alive(stillStarting)
=> true
```

That holds end to end, not just in the classifier. Break the liveness oracle —
here by shadowing the `jq` it serializes its answer with, so it exits non-zero
and reports nothing at all — and a daemon every other signal calls an orphan
survives anyway.

```ts
await mkdir(join(home, "brokenbin"), { recursive: true });
await symlink("/usr/bin/false", join(home, "brokenbin/jq"));
const unknowable = await browserFor("dead-wt");
const brokenLog = await sweep({ PATH: `${join(home, "brokenbin")}:${process.env.PATH}` });
JSON.stringify({ alive: alive(unknowable), warned: brokenLog.includes("liveness unknown for dead-wt") })
=> {"alive":true,"warned":true}
```

```ts cleanup
for (const pid of spawned) { try { process.kill(pid, "SIGKILL"); } catch { /* already reaped */ } }
await rm(home, { recursive: true, force: true });
```
