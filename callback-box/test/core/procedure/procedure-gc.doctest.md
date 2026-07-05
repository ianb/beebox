# Procedure Run GC

`cb procedure gc` deletes run directories whose `expires` stamp has passed,
and — as a backstop against a runaway procedure — caps each procedure at
`MAX_RUNS_PER_PROCEDURE` retained dirs regardless of expiry. The policy lives
on each run card; the sweeper is dumb. Always kept: the newest run per
procedure (`cb procedure status` reads it), runs pinned with `expires: never`,
and anything still running.

```ts setup
import { gcProcedureRuns } from "../../../src/core/procedure/gc.js";
import { MAX_RUNS_PER_PROCEDURE } from "../../../src/core/procedure/run-expiry.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { getLog } from "../../../src/cli/lib/git.js";
import { utimes } from "node:fs/promises";

// Builds a frontmatter run card from the legacy `key="value"` attr string
// the test cases use — values are JSON-quoted so ISO timestamps stay strings.
function runCard(attrs: string): string {
  const lines = [];
  for (const m of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) {
    lines.push(`${m[1]}: ${JSON.stringify(m[2])}`);
  }
  return `---\n${lines.join("\n")}\nsteps:\n  - id: s\n    status: completed\n---\n`;
}
```

## Expired runs are deleted; newest, pinned, and unexpired survive

```ts
const box = await makeTmpBox({ git: true });

// alpha: two expired runs — keep-newest saves the second despite expiry
await box.write("procedure/runs/alpha_2025-01-01T0000/run.procedure-run.card",
  runCard('procedure="p" status="completed" started-at="2025-01-01T00:00:00Z" completed-at="2025-01-01T00:01:00Z" expires="2025-02-01T00:00:00Z"'));
await box.write("procedure/runs/alpha_2025-02-01T0000/run.procedure-run.card",
  runCard('procedure="p" status="completed" started-at="2025-02-01T00:00:00Z" completed-at="2025-02-01T00:01:00Z" expires="2025-03-01T00:00:00Z"'));

// beta: old run pinned with expires="never", plus a newer one
await box.write("procedure/runs/beta_2025-01-01T0000/run.procedure-run.card",
  runCard('procedure="p" status="completed" started-at="2025-01-01T00:00:00Z" completed-at="2025-01-01T00:01:00Z" expires="never"'));
await box.write("procedure/runs/beta_2026-06-01T0000/run.procedure-run.card",
  runCard('procedure="p" status="completed" started-at="2026-06-01T00:00:00Z" completed-at="2026-06-01T00:01:00Z" expires="2099-01-01T00:00:00Z"'));

// gamma: legacy cards without expires — completed-at + 30d default applies
await box.write("procedure/runs/gamma_2025-01-01T0000/run.procedure-run.card",
  runCard('procedure="p" status="completed" started-at="2025-01-01T00:00:00Z" completed-at="2025-01-01T00:01:00Z"'));
await box.write("procedure/runs/gamma_2099-01-01T0000/run.procedure-run.card",
  runCard('procedure="p" status="completed" started-at="2099-01-01T00:00:00Z" completed-at="2099-01-01T00:01:00Z"'));

box.commitAll("Seed run history");

const output = [];
const ctx = { boxRoot: box.root, writeLine: (s) => output.push(s), write: () => {} };
const result = await gcProcedureRuns(ctx);
print(`success: ${result.success}`);
print(`removed: ${result.data.removed.sort().join(", ")}`);

const left = await box.list("procedure/runs");
const dirs = left.split("\n").filter(f => !f.endsWith(".card")).map(f => f.replace("procedure/runs/", ""));
print(`kept: ${dirs.join(", ")}`);

// The deletions were committed in one sweep
const log = await getLog(box.root, 1);
print(`commit: ${log[0].subject}`);
=>
success: true
removed: alpha_2025-01-01T0000, gamma_2025-01-01T0000
kept: alpha_2025-02-01T0000, beta_2025-01-01T0000, beta_2026-06-01T0000, gamma_2099-01-01T0000
commit: GC procedure runs: removed 2 expired run dir(s)
```

```ts cleanup
await box.cleanup();
```

## The per-procedure cap evicts oldest runs beyond the ceiling

Even when every run is unexpired, a procedure keeps at most
`MAX_RUNS_PER_PROCEDURE` dirs — the newest are retained and the oldest
overflow is reclaimed. This bounds a procedure that fails (or completes)
every tick before the 90d/30d age clock ever kicks in.

```ts
const box = await makeTmpBox({ git: true });

// Seed cap+3 unexpired runs for one procedure. Dir names end in a sortable
// timestamp; only the ceiling (not expiry) can prune these.
const total = MAX_RUNS_PER_PROCEDURE + 3;
for (let i = 0; i < total; i++) {
  const stamp = `2025-01-01T${String(i).padStart(4, "0")}`;
  await box.write(`procedure/runs/loop_${stamp}/run.procedure-run.card`,
    runCard(`procedure="loop" status="completed" started-at="2025-01-01T00:00:00Z" completed-at="2025-01-01T00:01:00Z" expires="2099-01-01T00:00:00Z"`));
}
box.commitAll("Seed a runaway procedure");

const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
const result = await gcProcedureRuns(ctx);

const left = await box.list("procedure/runs");
const kept = left.split("\n").filter(f => f.includes("loop_") && !f.endsWith(".card")).length;
print(`removed count: ${result.data.removed.length}`);
print(`oldest removed: ${result.data.removed.sort()[0]}`);
print(`kept equals cap: ${kept === MAX_RUNS_PER_PROCEDURE}`);
=>
removed count: 3
oldest removed: loop_2025-01-01T0000
kept equals cap: true
```

```ts cleanup
await box.cleanup();
```

## Crashed runs expire on the failed-run clock

A run card stuck at status="running" (the engine crashed or was killed)
has no completed-at. Once its card mtime is stale — a fresh mtime means
it may genuinely be running — it expires at started-at plus the failed-run
default, since crash debris is failure-like.

```ts
const box = await makeTmpBox({ git: true });

await box.write("procedure/runs/crash_2025-01-01T0000/run.procedure-run.card",
  runCard('procedure="p" status="running" started-at="2025-01-01T00:00:00Z"'));
await box.write("procedure/runs/crash_2099-01-01T0000/run.procedure-run.card",
  runCard('procedure="p" status="completed" started-at="2099-01-01T00:00:00Z" completed-at="2099-01-01T00:01:00Z" expires="never"'));

// Age the crashed card's mtime past the running-detection staleness window
const stale = new Date(Date.now() - 2 * 60 * 60 * 1000);
await utimes(box.path("procedure/runs/crash_2025-01-01T0000/run.procedure-run.card"), stale, stale);
box.commitAll("Seed crashed run");

const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
const result = await gcProcedureRuns(ctx);
print(`removed: ${result.data.removed.join(", ")}`);
=>
removed: crash_2025-01-01T0000
```

```ts cleanup
await box.cleanup();
```

## A fresh running card is never collected

The same stuck-running card with a fresh mtime is treated as live work
and left alone, even though its started-at is ancient.

```ts
const box = await makeTmpBox({ git: true });

await box.write("procedure/runs/live_2025-01-01T0000/run.procedure-run.card",
  runCard('procedure="p" status="running" started-at="2025-01-01T00:00:00Z"'));
await box.write("procedure/runs/live_2099-01-01T0000/run.procedure-run.card",
  runCard('procedure="p" status="completed" started-at="2099-01-01T00:00:00Z" completed-at="2099-01-01T00:01:00Z" expires="never"'));
box.commitAll("Seed live run");

const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
const result = await gcProcedureRuns(ctx);
print(`removed: ${result.data.removed.length}`);
=>
removed: 0
```

```ts cleanup
await box.cleanup();
```

## Empty and missing runs dirs are fine

```ts
const box = await makeTmpBox({ git: true });
const ctx = { boxRoot: box.root, writeLine: () => {}, write: () => {} };
const result = await gcProcedureRuns(ctx);
print(`success: ${result.success}, removed: ${result.data.removed.length}`);
=>
success: true, removed: 0
```

```ts cleanup
await box.cleanup();
```
