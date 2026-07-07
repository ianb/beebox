# Hub child output forwarding

A hub-spawned box child's stdout/stderr are piped (not inherited) so the hub
can supervise it, but nothing used to read those pipes — execa just buffers
them in memory and they vanish when the child exits (or the hub restarts).
That meant a chat turn's `warnErroredTurn` diagnostic (the SDK's own error
detail on a failed turn) went to the child's stderr and was gone for good —
see `issues/2026-07-07-box-child-stderr-not-surfaced.md`. `forwardChildOutput`
appends both streams, line-buffered and tagged, to a per-box rolling log file
so that detail survives.

```ts setup
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { forwardChildOutput } from "../../src/hub/child-output-log.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

## stdout and stderr both land in the log, line-buffered

A chunk that arrives split across multiple writes (`"Warn"` then
`"ing: ...\n"`) is only flushed once the newline completes it -- no
half-line gets logged.

```ts
const box = await makeTmpBox();
t.teardown(() => box.cleanup());

const stdout = new PassThrough();
const stderr = new PassThrough();
const logFile = box.path(".callback-box/hub-child.log");

forwardChildOutput({ child: { stdout, stderr }, logFile });

stdout.write("child ready on port 4000\n");
stderr.write("Warn");
stderr.write("ing: something odd\n");

await delay(50);

const content = await box.read(".callback-box/hub-child.log");
// Strip the leading ISO timestamp (nondeterministic) from each line.
content.replace(/^\S+ /gm, "")
=> [stdout] child ready on port 4000
[stderr] Warning: something odd
```

A `null` stream (no stdio piped) is a no-op rather than a crash:

```ts continue
forwardChildOutput({ child: { stdout: null, stderr: null }, logFile: box.path(".callback-box/other.log") });
true
=> true
```
