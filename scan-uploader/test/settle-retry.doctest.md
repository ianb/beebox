# Settle retry across a run

The launchd agent fires on `WatchPaths` as well as on its interval, so a run
routinely starts the instant a file lands — inside the 10-second settle window,
while the scanner may still be writing. A run that simply skipped such a file
would leave it until the next filesystem event or the next interval sweep,
which is the latency the watch exists to remove. So a run comes back for any
target that skipped something as unsettled.

The seams below stand in for the real uploader and the real wait, so the policy
is asserted without spending a settle window.

```ts setup
import { runAllTargets, type RunAllDeps } from "../src/run-all.js";
import type { TargetConfig, UploaderConfig } from "../src/config.js";
import type { RunSummary } from "../src/run-target.js";

const target = (folder: string): TargetConfig => ({
  folder,
  serverUrl: "https://example.test",
  box: "b",
  tokenPath: "/tokens/b.token",
  disposition: "keep",
});

const summary = (over: Partial<RunSummary>): RunSummary => ({
  uploaded: 0,
  duplicate: 0,
  rejected: 0,
  rejectedOnUpload: 0,
  skippedUnsettled: 0,
  skippedIdentityChanged: 0,
  errors: 0,
  ...over,
});

interface Scripted {
  readonly deps: RunAllDeps;
  readonly calls: string[];
  readonly waits: number[];
}

/** Plays one scripted summary per call per folder, and records every wait.
 * A folder with no script left keeps returning an all-zero summary. */
function scripted(script: Record<string, RunSummary[]>): Scripted {
  const calls: string[] = [];
  const waits: number[] = [];
  const deps: RunAllDeps = {
    runOne: (t) => {
      calls.push(t.folder);
      return Promise.resolve(script[t.folder]?.shift() ?? summary({}));
    },
    wait: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
  };
  return { deps, calls, waits };
}

const config: UploaderConfig = { targets: [target("/receipts"), target("/family")] };
```

A run with nothing unsettled visits each target once and never waits:

```
const settled = scripted({});
await runAllTargets(config, { retryRejected: false, deps: settled.deps });
`${settled.calls.join(" ")} | waits=${String(settled.waits.length)}`
=> /receipts /family | waits=0
```

A target that skipped an unsettled file is retried — and *only* that target;
the settled one is not re-walked:

```
const one = scripted({ "/receipts": [summary({ skippedUnsettled: 1 }), summary({ uploaded: 1 })] });
const oneResult = await runAllTargets(config, { retryRejected: false, deps: one.deps });
`${one.calls.join(" ")} | waits=${String(one.waits.length)} | exit=${String(oneResult.exitCode)}`
=> /receipts /family /receipts | waits=1 | exit=0
```

The wait covers the whole settle window rather than landing exactly on its
boundary:

```continue
one.waits[0] >= 10_000
=> true
```

A file that never settles does not retry forever: three rounds, then the run
ends and leaves it for the next interval sweep. Four calls, three waits.

```
const forever = scripted({});
const stuck: RunAllDeps = {
  runOne: (t) => {
    forever.calls.push(t.folder);
    return Promise.resolve(summary({ skippedUnsettled: 1 }));
  },
  wait: forever.deps.wait,
};
await runAllTargets({ targets: [target("/receipts")] }, { retryRejected: false, deps: stuck });
`calls=${String(forever.calls.length)} waits=${String(forever.waits.length)}`
=> calls=4 waits=3
```

An unsettled skip is not a failure — the file is simply not ready yet, so the
exit code stays 0. A rejection still fails the run:

```
const rejectedRun = scripted({ "/receipts": [summary({ rejected: 1 })] });
(await runAllTargets({ targets: [target("/receipts")] }, { retryRejected: false, deps: rejectedRun.deps })).exitCode
=> 1
```

## Per-box totals, for the desktop notification

The run also hands back what each box actually took in, which is all
`src/notify.ts` needs to decide whether to post a banner. Totals sum across
targets *and* across retry rounds, so a file that was unsettled in round 1 and
uploaded in round 2 is one upload for the box, not two events to report. Both
targets in `config` point at box `b`:

```
const counted = scripted({
  "/receipts": [summary({ skippedUnsettled: 1 }), summary({ uploaded: 2, rejectedOnUpload: 1, rejected: 1 })],
  "/family": [summary({ uploaded: 1 })],
});
const countedResult = await runAllTargets(config, { retryRejected: false, deps: counted.deps });
JSON.stringify(countedResult.boxes.map((b) => [b.box, b.summary.uploaded, b.summary.rejectedOnUpload]))
=> [["b",3,1]]
```

Two targets can carry the same box slug against *different* servers —
`configure` appends rather than replaces when the same box is given a new
`serverUrl` — so grouping is by server AND box. Merging them would have made
the contract-version verdict depend on target order, one endpoint's answer
silently overwriting the other's:

```
const twoServers: UploaderConfig = {
  targets: [
    { ...target("/receipts"), serverUrl: "https://old.test", box: "b" },
    { ...target("/family"), serverUrl: "https://new.test", box: "b" },
  ],
};
const versions = scripted({
  "/receipts": [summary({ contractVersion: 1 })],
  "/family": [summary({ contractVersion: 2 })],
});
const twoResult = await runAllTargets(twoServers, { retryRejected: false, deps: versions.deps });
JSON.stringify(twoResult.boxes.map((b) => [b.box, b.summary.contractVersion]))
=> [["b",1],["b",2]]
```

A target that threw contributes no entry at all — there is no summary to
count, and the failure is already on stderr and in the exit code:

```
const brokenOnly = await runAllTargets(
  { targets: [target("/gone")] },
  { retryRejected: false, deps: { runOne: () => Promise.reject(new Error("ENOENT")), wait: () => Promise.resolve() } },
);
brokenOnly.boxes.length
=> 0
```

A target whose folder is missing or unreadable fails that target alone.
`listCandidateFiles` throws straight out of `readdir` — ENOENT on a renamed or
unmounted folder, EACCES on a permissions change — and one throw used to
abandon the whole run, so a stale first target meant the second never swept.
The run reports it, exits non-zero, and keeps going:

```
const thrown: RunAllDeps = {
  runOne: (t) => {
    if (t.folder === "/gone") return Promise.reject(new Error("ENOENT: no such directory"));
    return Promise.resolve(summary({ uploaded: 1 }));
  },
  wait: () => Promise.resolve(),
};
const swept: string[] = [];
const result = await runAllTargets(
  { targets: [target("/gone"), target("/still-here")] },
  {
    retryRejected: false,
    deps: {
      runOne: (t, o) => {
        swept.push(t.folder);
        return thrown.runOne(t, o);
      },
      wait: thrown.wait,
    },
  },
);
`${swept.join(" ")} | exit=${String(result.exitCode)}`
=> /gone /still-here | exit=1
```

A throwing target is not retried as unsettled — it produced no summary at all,
so it fails this run and waits for the next trigger rather than spinning:

```
const waits: number[] = [];
const allThrow: RunAllDeps = {
  runOne: () => Promise.reject(new Error("ENOENT")),
  wait: (ms) => {
    waits.push(ms);
    return Promise.resolve();
  },
};
await runAllTargets({ targets: [target("/gone")] }, { retryRejected: false, deps: allThrow });
waits.length
=> 0
```
