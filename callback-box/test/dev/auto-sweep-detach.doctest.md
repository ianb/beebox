# The worktree sweep outlives the session that triggered it

`.claude/hooks/auto-sweep.sh` fires a global worktree sweep on every session
start and end. The sweep must not block its caller, must not run twice at once,
and — the part that was broken — must survive the teardown of the session whose
exit triggered it.

The old form was `( … ) & disown`, which is not detachment: `disown` drops the
job from bash's table but leaves the child in the caller's process group, so a
group-wide kill at session exit took the sweep with it. It showed up in
`worktree-cleanup.log` as a `START` line with nothing after it — 15 of 109
SessionEnd sweeps, against zero of the 44 SessionStart and 72 codex ones, which
is exactly the population whose caller is dying.

Everything below runs against a fake main checkout and a scratch `HOME`, with a
stand-in `bin/workstreams` that just sleeps, so no real worktree is ever at risk.

```ts setup
import { execFile, spawn } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd(), "..");

const root = await mkdtemp(join(tmpdir(), "auto-sweep-doctest-"));
const home = join(root, "home");
const fakeRepo = join(root, "repo");
const log = join(home, ".cache/callback-box/worktree-cleanup.log");
const lock = join(home, ".cache/callback-box/sweep.lock");

// A main-checkout shape: the hook gates itself out when its own repo is under
// callback-worktrees, so the scratch copy must not look like a worktree.
await mkdir(join(fakeRepo, ".claude/hooks"), { recursive: true });
await mkdir(join(fakeRepo, "bin/lib"), { recursive: true });
await mkdir(join(home, ".cache/callback-box"), { recursive: true });
await cp(join(repoRoot, ".claude/hooks/auto-sweep.sh"), join(fakeRepo, ".claude/hooks/auto-sweep.sh"));
await cp(join(repoRoot, "bin/lib/detach.mjs"), join(fakeRepo, "bin/lib/detach.mjs"));

/** Stand-in for `bin/workstreams sweep`: takes `seconds`, touches nothing. */
async function fakeSweep(seconds: number) {
  const p = join(fakeRepo, "bin/workstreams");
  await writeFile(p, `#!/bin/sh\necho "sweeping"\nsleep ${seconds}\n`);
  await chmod(p, 0o755);
}

const hook = join(fakeRepo, ".claude/hooks/auto-sweep.sh");
const env = { ...process.env, HOME: home };

async function readLog() {
  return readFile(log, "utf8").catch(() => "");
}
async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
/** Wait until `pred` holds over the log, or give up after ~10s. */
async function until(pred: (s: string) => boolean) {
  for (let i = 0; i < 100; i++) {
    const s = await readLog();
    if (pred(s)) return s;
    await sleep(100);
  }
  return readLog();
}
```

## The caller returns immediately, and the sweep runs on its own

```ts
await fakeSweep(2);
const started = Date.now();
await execFileAsync(hook, ["session-end"], { env });
const callerMs = Date.now() - started;

const finished = await until((s) => s.includes("END"));
JSON.stringify({
  callerReturnedFast: callerMs < 1500,
  ran: finished.includes("auto-sweep trigger=session-end START"),
  finished: finished.includes("auto-sweep trigger=session-end END"),
})
=> {"callerReturnedFast":true,"ran":true,"finished":true}
```

## Killing the caller's process group does not kill the sweep

This is the regression. The launcher is started in a session of its own and then
killed group-wide, which is what happens to a hook when its Claude session tears
down.

```ts continue
await rm(log, { force: true });
await fakeSweep(2);
const launcher = spawn(hook, ["session-end"], { env, detached: true, stdio: "ignore" });
await new Promise((r) => launcher.on("exit", r));
await sleep(300);
try { process.kill(-launcher.pid!, "SIGKILL"); } catch { /* already gone */ }

const afterKill = await until((s) => s.includes("END"));
afterKill.includes("auto-sweep trigger=session-end END")
=> true
```

## One sweep at a time

A second trigger while one is running is skipped, not queued: it would only
contend for the same git work, and there is always another session start or end
to run it.

```ts continue
await rm(log, { force: true });
await fakeSweep(3);
await execFileAsync(hook, ["session-end"], { env });
await until((s) => s.includes("START"));
await execFileAsync(hook, ["session-start"], { env });

const both = await until((s) => s.includes("SKIPPED"));
JSON.stringify({
  skipped: /auto-sweep trigger=session-start SKIPPED \(sweep \d+ already running\)/.test(both),
  onlyOneStart: (both.match(/START/g) ?? []).length === 1,
})
=> {"skipped":true,"onlyOneStart":true}
```

A lock left behind by a killed sweep is reclaimed rather than wedging every
later run — the failure this whole file is about is a sweep being killed, so the
lock must not turn that into a permanent one.

```ts continue
await until((s) => s.includes("END"));
await rm(log, { force: true });
await mkdir(lock, { recursive: true });
await writeFile(join(lock, "pid"), "999999\n"); // a pid that cannot be alive
await fakeSweep(0);
await execFileAsync(hook, ["session-end"], { env });

const reclaimed = await until((s) => s.includes("END"));
JSON.stringify({
  noticed: reclaimed.includes("reclaiming stale lock"),
  ranAnyway: reclaimed.includes("auto-sweep trigger=session-end END"),
})
=> {"noticed":true,"ranAnyway":true}
```

## An interrupted sweep says so

A `START` with nothing after it used to be ambiguous between "still running" and
"was killed". A caught signal now names itself; SIGKILL still cannot be caught,
so a `START` with neither `END` nor `INTERRUPTED` means exactly that, which is
the diagnosis rather than a mystery.

```ts continue
await rm(log, { force: true });
await fakeSweep(1);
await execFileAsync(hook, ["session-end"], { env });
await until((s) => s.includes("START"));
const sweepPid = Number((await readFile(join(lock, "pid"), "utf8")).trim());
process.kill(sweepPid, "SIGTERM");

const interrupted = await until((s) => s.includes("INTERRUPTED"));
interrupted.includes("auto-sweep trigger=session-end INTERRUPTED sig=TERM")
=> true
```

## The SessionEnd hook triggers it from every exit path

The hook does two jobs: tear down the worktree this session owned, and fire the
global sweep. The sweep call used to sit inline above the teardown, with a
comment saying it had to be there or it would not fire in the common case —
which was true of the *reachability*, since the teardown ends in a wall of early
`exit 0`s. An `EXIT` trap is reached from all of them and still runs last, so
the cheap specific job goes first and the two stop overlapping their git work.

The case below is the commonest early exit of all — a session that did not
belong to any worktree — driven against a scratch checkout so nothing real is
in scope.

```ts continue
const fakeMono = join(root, "mono");
await mkdir(join(fakeMono, "callback-box"), { recursive: true });
await execFileAsync("git", ["init", "-q"], { cwd: fakeMono });
await cp(join(repoRoot, ".claude/hooks"), join(fakeMono, ".claude/hooks"), { recursive: true });
await cp(join(repoRoot, "bin/lib"), join(fakeMono, "bin/lib"), { recursive: true });
await fakeSweep(0);
await cp(join(fakeRepo, "bin/workstreams"), join(fakeMono, "bin/workstreams"));

await rm(log, { force: true });
const hookInput = JSON.stringify({
  cwd: fakeMono,
  session_id: "no-worktree",
  transcript_path: join(tmpdir(), "nowhere.jsonl"),
  reason: "prompt_input_exit",
});
await execFileAsync(
  "bash",
  ["-c", 'printf "%s" "$1" | "$2"', "hook-test", hookInput, join(fakeMono, ".claude/hooks/session-end.sh")],
  { env: { ...env, CALLBACK_STATE_DIR: join(home, ".cache/callback-box") } },
).catch(() => undefined);

const fromEarlyExit = await until((s) => s.includes("END"));
JSON.stringify({
  tookTheEarlyExit: fromEarlyExit.includes("decision=skip:not-a-worktree-session"),
  sweptAnyway: fromEarlyExit.includes("auto-sweep trigger=session-end END"),
})
=> {"tookTheEarlyExit":true,"sweptAnyway":true}
```

```ts cleanup
await rm(root, { recursive: true, force: true });
```
