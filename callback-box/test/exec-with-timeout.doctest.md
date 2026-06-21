# Sleep-immune command execution

`execWithTimeout` runs a shell command in its own process group and kills the
whole tree once the command exceeds its *awake-time* budget. The budget is
tracked by `startAwakeTimeout`, which ticks a short interval and discards any
tick gap far larger than the period — on macOS, libuv's timer clock counts
system sleep, so a plain `setTimeout` would fire the instant the machine wakes
and kill a run that barely got to execute.

```ts setup
import { startAwakeTimeout } from "../src/lib/awake-timeout.js";
import {
  execWithTimeout,
  CommandError,
  CommandTimedOutError,
  CommandFailedError,
  SCRIPT_TIMEOUT,
} from "../src/lib/exec-with-timeout.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
```

## startAwakeTimeout

Accumulates awake time across ticks and fires `onTimeout` when the budget is
spent:

```ts
let fired = null;
const timer = startAwakeTimeout({ timeoutMs: 60, periodMs: 10, onTimeout: (e) => { fired = e; } });
await sleep(150);
fired !== null
=> true

fired.awakeMs >= 60
=> true

fired.sleepDetected
=> false
```

A gap between ticks far larger than the period means the machine slept (here
simulated by blocking the event loop so the interval can't fire). The gap is
flagged but not counted toward the deadline:

```ts
let fired = null;
const timer = startAwakeTimeout({ timeoutMs: 5_000, periodMs: 10, sleepGapMs: 60, onTimeout: (e) => { fired = e; } });
await sleep(40);
const blockUntil = Date.now() + 150;
while (Date.now() < blockUntil) { /* "sleep" */ }
await sleep(40);
const elapsed = timer.elapsed();
timer.stop();
print(`fired: ${fired === null ? "no" : "yes"}`);
print(`sleepDetected: ${elapsed.sleepDetected}`);
print(`sleep counted as awake: ${elapsed.awakeMs >= 150}`);
print(`wall includes sleep: ${elapsed.wallMs >= 150}`);
"done"
=>
fired: no
sleepDetected: true
sleep counted as awake: false
wall includes sleep: true
done
```

`stop()` freezes the awake counter; the timer never fires afterwards:

```ts
let fired = null;
const timer = startAwakeTimeout({ timeoutMs: 30, periodMs: 10, onTimeout: (e) => { fired = e; } });
timer.stop();
await sleep(80);
fired
=> null
```

## execWithTimeout

The default budget is 10 minutes of awake runtime:

```ts
SCRIPT_TIMEOUT
=> 600000
```

A successful command resolves with its measured timing:

```ts
const timing = await execWithTimeout("true", { cwd: process.cwd(), stdio: "ignore", timeout: 5_000, env: process.env });
print(`durationMs is a number: ${typeof timing.durationMs === "number"}`);
print(`sleepAffected: ${timing.sleepAffected}`);
"ran"
=>
durationMs is a number: true
sleepAffected: false
ran
```

A non-zero exit rejects with `CommandFailedError`, carrying the exit code,
output tails, and the same timing:

```ts
const err = await execWithTimeout("echo oops >&2; exit 3", { cwd: process.cwd(), stdio: "ignore", timeout: 5_000, env: process.env }).catch((e) => e);
err instanceof CommandFailedError
=> true

err instanceof CommandError
=> true

err.message
=> Command failed with exit code 3
stderr:
oops

typeof err.timing.durationMs
=> number
```

A command that outlives its awake-time budget is killed (whole process group,
SIGKILL) and rejects with `CommandTimedOutError`:

```ts
const err = await execWithTimeout("sleep 30", { cwd: process.cwd(), stdio: "ignore", timeout: 50, periodMs: 10, env: process.env }).catch((e) => e);
err instanceof CommandTimedOutError
=> true

err.message.startsWith("Command timed out after 50ms of awake runtime")
=> true

err.timing.durationMs >= 50
=> true
```
