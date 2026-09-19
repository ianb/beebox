# Box growth measurement and policy

Box growth is sampled by the scheduler and persisted outside Git. The scanner
counts content without following symlinks, attributes bounded subtree summaries,
and keeps Git failure distinct from a zero-sized history.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import {
  boxGrowthStatePath,
  BOX_GROWTH_THRESHOLDS,
  acknowledgeCurrentBoxGrowth,
  boxGrowthHealthCheck,
  evaluateBoxGrowth,
  expectCurrentBoxGrowthRates,
  measureBoxGrowth,
  measureBoxGrowthIfDue,
  readBoxGrowthState,
} from "../../src/core/box-growth/health.js";
const at = (iso) => new Date(iso);
```

## Tree counting, exclusions, attribution, and Git

A fresh v3 box already carries the scaffolded skeleton (every underscore
area, `src/`), so counts and subtree attribution are asserted as a delta
against a baseline measured right after `makeTmpBox` — before this test adds
anything of its own.

```ts
const box = await makeTmpBox({ git: true });
const baseline = await measureBoxGrowth(box.root, { now: at("2026-08-05T11:00:00Z") });

await box.write("_content/inbox/email/thread/message.txt", "mail");
await box.write("_content/chat/session/transcript.md", "chat");
await box.write("_content/drive/folder/deep/document.md", "drive");
await box.write("_content/drive/folder/deep/line\nbreak.md", "drive with newline");
await box.write("tmp-upload/image.jpg", "image");
await box.write(".beebox/ignored.txt", "state");
await fs.mkdir(box.path("node_modules/pkg"), { recursive: true });
await fs.writeFile(box.path("node_modules/pkg/index.js"), "ignored");
await fs.mkdir(box.path("_content/chat/session/node_modules/pkg"), { recursive: true });
await fs.writeFile(box.path("_content/chat/session/node_modules/pkg/index.js"), "ignored nested dependency");
await fs.mkdir(box.path("_content/chat/session/nested/.git/objects"), { recursive: true });
await fs.writeFile(box.path("_content/chat/session/nested/.git/objects/object"), "ignored nested repo");
await fs.symlink(box.path("_content/inbox"), box.path("box-link"));
box.commitAll("seed growth fixture");

const measured = await measureBoxGrowth(box.root, { now: at("2026-08-05T12:00:00Z") });

// Connector subtrees always float to the ranked top regardless of size, so
// they reliably survive the size cap below. Every other entry —
// `_content/chat/session`, `tmp-upload`, `box-link` — is the same size as
// many of the skeleton's own "unknown" entries and can lose a ranking tie
// against them, so only the connector paths are asserted here.
print(`directories: ${measured.counts.directories - baseline.counts.directories}`);
print(`files: ${measured.counts.files - baseline.counts.files}`);
print(`complete: ${measured.complete}`);
print(`history: ${measured.history.status}`);
const baselineFiles = new Map(baseline.largestSubtrees.map((item) => [item.path, item.files]));
const subtreeLabel = (p) => {
  const item = measured.largestSubtrees.find((i) => i.path === p);
  const delta = item === undefined ? undefined : item.files - (baselineFiles.get(p) ?? 0);
  return `${p}:${item?.source}:${delta}`;
};
print(["_content/drive", "_content/inbox/email"].map(subtreeLabel).join("\n"));
=>
directories: 7
files: 6
complete: true
history: available
_content/drive:connector:2
_content/inbox/email:connector:1

measured.largestSubtrees.length <= 20
=> true
```

```ts cleanup
await box.cleanup();
```

## Hourly and connector-weighted policy; size alone is never a finding

```ts
const base = {
  measuredAt: "2026-08-05T12:00:00.000Z",
  complete: true,
  skippedDirectories: 0,
  counts: { directories: 100, files: 100 },
  history: { status: "available", gitHead: "a", commits: 10, gitObjects: 20, gitBytes: 30 },
  largestSubtrees: [{ path: "_content/inbox/email", directories: 20, files: 20, source: "connector", sourceLabel: "Gmail" }],
};
const fast = {
  ...base,
  measuredAt: "2026-08-05T13:00:00.000Z",
  counts: { directories: 210, files: 210 },
  history: { ...base.history, commits: 111 },
  largestSubtrees: [{ ...base.largestSubtrees[0], directories: 121, files: 121 }],
};
const findings = evaluateBoxGrowth({ previous: base, current: fast });
print(findings.map((finding) => `${finding.kind}:${finding.path ?? "box"}`).join("\n"));
=>
rate-directories:_content/inbox/email
rate-files:_content/inbox/email
rate-commits:box
rate-connector-directories:_content/inbox/email
rate-connector-files:_content/inbox/email

print(`${BOX_GROWTH_THRESHOLDS.rateDirectoriesPerHour}:${BOX_GROWTH_THRESHOLDS.rateFilesPerHour}:${BOX_GROWTH_THRESHOLDS.rateCommitsPerHour}`);
=> 10:25:10
```

A box is never warned about for being large. One Gmail account with a few
hundred archived threads holds thousands of files and directories, and a
fixed level warned about it permanently while saying nothing useful. A large
box growing slowly has no finding:

```ts continue
const large = { ...base, counts: { directories: 1_800, files: 3_500 } };
const slightlyLarger = { ...large, measuredAt: "2026-08-05T13:00:00.000Z", counts: { directories: 1_801, files: 3_502 } };
evaluateBoxGrowth({ previous: large, current: slightlyLarger }).length
=> 0

const enteredTopTwenty = { ...fast, largestSubtrees: [{ ...fast.largestSubtrees[0], path: "_content/drive" }] };
evaluateBoxGrowth({ previous: base, current: enteredTopTwenty }).some((item) => item.kind.startsWith("rate-connector"))
=> true

const newImport = {
  ...fast,
  counts: { directories: 100, files: 600 },
  largestSubtrees: [{
    path: "store/import-2026/batch1",
    directories: 0,
    files: 500,
    source: "unknown",
    sourceLabel: null,
  }],
};
evaluateBoxGrowth({ previous: base, current: newImport })
  .find((item) => item.kind === "rate-files")?.path
=> store/import-2026/batch1

const partial = { ...fast, complete: false };
evaluateBoxGrowth({ previous: base, current: partial })
  .some((item) => item.kind.startsWith("rate-"))
=> false
```

## Box-shape failure degrades only Git history

```ts
const badShape = await makeTmpBox();
const badShapeBaseline = await measureBoxGrowth(badShape.root, { now: at("2026-08-05T11:00:00Z") });
await badShape.write("plain.txt", "content");
await fs.writeFile(badShape.path(".beebox/box.json"), JSON.stringify({ shapeVersion: 1 }));
const badShapeMeasurement = await measureBoxGrowth(badShape.root, {
  now: at("2026-08-05T12:00:00Z"),
});
print(`${badShapeMeasurement.counts.files - badShapeBaseline.counts.files}:${badShapeMeasurement.history.status}`);
=> 1:unavailable
```

```ts cleanup
await badShape.cleanup();
```

## Persisted baseline, due interval, acknowledgement, and health

The first scan establishes a baseline. A second call inside the hour is skipped;
after a growth warning, accepting the current size re-baselines all three
measurements and removes the action.

```ts
const box = await makeTmpBox({ git: true });
const first = await measureBoxGrowthIfDue(box.root, { now: at("2026-08-05T12:00:00Z") });
print(first.status);
const skipped = await measureBoxGrowthIfDue(box.root, { now: at("2026-08-05T12:30:00Z") });
print(skipped.status);

const state = await readBoxGrowthState(box.root);
print(state.status);
print(path.relative(box.root, boxGrowthStatePath(box.root)));
await fs.unlink(boxGrowthStatePath(box.root));
const missingBackoff = await measureBoxGrowthIfDue(box.root, {
  now: at("2026-08-05T12:31:00Z"),
  maxDurationMs: 0,
});
print(`${missingBackoff.status}:${missingBackoff.reason}`);
=>
measured
skipped
measured
.beebox/box-growth-health.json
skipped:not-due

await box.write("_content/inbox/email/new/message.txt", "mail");
const replacement = await measureBoxGrowthIfDue(box.root, { now: at("2026-08-05T13:00:00Z") });
print(replacement.status === "measured" && replacement.notice !== null);
const followup = await measureBoxGrowthIfDue(box.root, { now: at("2026-08-05T14:00:00Z") });
print(followup.status === "measured" && followup.state.lastNotice !== null);
const replacementHealth = await boxGrowthHealthCheck(box.root, {
  now: at("2026-08-05T14:00:00Z"),
  schedulerStatus: "running",
});
print(`${replacementHealth.ok}:${replacementHealth.actions?.join(",")}`);
const accepted = await acknowledgeCurrentBoxGrowth(box.root);
print(accepted.status);
print(accepted.status === "measured" && accepted.previous.measuredAt === accepted.current.measuredAt);
print(accepted.status === "measured" ? accepted.rateExpectations.length : -1);
const health = await boxGrowthHealthCheck(box.root, { now: at("2026-08-05T14:01:00Z"), schedulerStatus: "running" });
print(`${health.name}:${health.ok}:${health.actions?.join(",") ?? "none"}`);
=>
true
true
false:acknowledge-box-growth
measured
true
0
box-growth:true:none
```

```ts cleanup
await box.cleanup();
```

## Corrupt state and failed scan stay visible

```ts
const corrupt = await makeTmpBox();
await fs.mkdir(path.dirname(boxGrowthStatePath(corrupt.root)), { recursive: true });
await fs.writeFile(boxGrowthStatePath(corrupt.root), "not json");
const corruptHealth = await boxGrowthHealthCheck(corrupt.root, {
  now: at("2026-08-05T12:00:00Z"),
  schedulerStatus: "running",
});
print(`${corruptHealth.ok}:${corruptHealth.message.includes("state")}`);

const invalidAttempt = await measureBoxGrowthIfDue(corrupt.root, {
  now: at("2026-08-05T13:00:00Z"),
});
print(`${invalidAttempt.status}:${invalidAttempt.reason}`);

const failedBox = await makeTmpBox();
const failed = await measureBoxGrowthIfDue(failedBox.root, {
  now: at("2026-08-05T13:00:00Z"),
  maxDurationMs: 0,
});
print(failed.status);
const failedState = await readBoxGrowthState(failedBox.root);
print(`${failedState.status}:${failedState.status === "measured" && failedState.current.complete}`);
print(failedState.status === "measured" ? failedState.current.filesystemError : "wrong state");
=>
false:true
skipped:invalid-state
measured
measured:false
Box growth scan exceeded its time budget
```

```ts cleanup
await corrupt.cleanup();
await failedBox.cleanup();
```

A traversal error also retains whatever the native walker reported instead of
discarding the sample.

```ts
const vanished = await makeTmpBox();
const vanishedRoot = vanished.root;
await vanished.cleanup();
const vanishedMeasurement = await measureBoxGrowth(vanishedRoot, {
  now: at("2026-08-05T13:00:00Z"),
});
print(`${vanishedMeasurement.complete}:${vanishedMeasurement.filesystemError !== null}`);
=> false:true
```

## Missing and stale scheduler state stay explicit

No scheduler heartbeat is normal for a local box. Once a scheduler is active,
missing state is a warning rather than a silent pass.

```ts
const missing = await makeTmpBox();
const localHealth = await boxGrowthHealthCheck(missing.root, {
  now: at("2026-08-05T12:00:00Z"),
  schedulerStatus: "never",
});
const scheduledHealth = await boxGrowthHealthCheck(missing.root, {
  now: at("2026-08-05T12:00:00Z"),
  schedulerStatus: "running",
});
print(`${localHealth.ok}:${scheduledHealth.ok}`);
=> true:false
```

```ts cleanup
await missing.cleanup();
```

A state file written before level findings were removed still carries
`accepted` and `acknowledgedAt: null`, which used to pin a permanent warning
on a large box. It now reads as healthy; the extra keys are dropped.

```ts
const warningBox = await makeTmpBox();
const warningMeasurement = {
  measuredAt: "2026-08-05T12:00:00.000Z",
  complete: true,
  counts: { directories: 20_000, files: 1_000 },
  history: { status: "available", gitHead: "head", commits: 10, gitObjects: 20, gitBytes: 30 },
  largestSubtrees: [{ path: "_content/inbox/email", directories: 19_000, files: 900, source: "connector", sourceLabel: "Gmail" }],
};
await fs.mkdir(path.dirname(boxGrowthStatePath(warningBox.root)), { recursive: true });
await fs.writeFile(boxGrowthStatePath(warningBox.root), JSON.stringify({
  version: 1,
  status: "measured",
  accepted: warningMeasurement,
  previous: warningMeasurement,
  current: warningMeasurement,
  acknowledgedAt: null,
  lastAttemptAt: warningMeasurement.measuredAt,
  lastError: null,
}));
const warningHealth = await boxGrowthHealthCheck(warningBox.root, {
  now: at("2026-08-05T12:01:00Z"),
  schedulerStatus: "running",
});
print(`${warningHealth.ok}:${warningHealth.actions?.join(",") ?? "none"}`);
print(warningHealth.message);
const rewritten = await readBoxGrowthState(warningBox.root);
print(rewritten.status === "measured" && !("acknowledgedAt" in rewritten));
=>
true:none
Box growth is within accepted limits
true
```

```ts cleanup
await warningBox.cleanup();
```

Independent connector growth never hides a larger box-wide producer.

```ts
const mixedBox = await makeTmpBox();
const mixedPrevious = {
  measuredAt: "2026-08-05T12:00:00.000Z",
  counts: { directories: 100, files: 100 },
  history: { status: "available", gitHead: "old", commits: 1, gitObjects: 1, gitBytes: 1 },
  largestSubtrees: [
    { path: "_content/inbox/email", directories: 10, files: 20, source: "connector", sourceLabel: "Gmail" },
    { path: "store/junk", directories: 0, files: 0, source: "unknown", sourceLabel: null },
  ],
};
const mixedCurrent = {
  ...mixedPrevious,
  measuredAt: "2026-08-05T13:00:00.000Z",
  counts: { directories: 100, files: 700 },
  largestSubtrees: [
    { ...mixedPrevious.largestSubtrees[0], files: 120 },
    { ...mixedPrevious.largestSubtrees[1], files: 500 },
  ],
};
await fs.mkdir(path.dirname(boxGrowthStatePath(mixedBox.root)), { recursive: true });
await fs.writeFile(boxGrowthStatePath(mixedBox.root), JSON.stringify({
  version: 1,
  status: "measured",
  previous: mixedPrevious,
  current: mixedCurrent,
  lastAttemptAt: mixedCurrent.measuredAt,
  lastError: null,
  lastNotice: null,
}));
const mixedHealth = await boxGrowthHealthCheck(mixedBox.root, {
  now: at("2026-08-05T13:01:00Z"),
  schedulerStatus: "running",
});
print(`${mixedHealth.message.includes("store/junk")}:${mixedHealth.message.includes("_content/inbox/email")}`);
print(mixedHealth.actions?.join(","));
const expectedRates = await expectCurrentBoxGrowthRates(mixedBox.root, {
  now: at("2026-08-05T13:01:00Z"),
});
if (expectedRates.status !== "measured") throw new Error("expected measured state");
print(expectedRates.rateExpectations.map((item) => `${item.kind}:${item.thresholdPerHour}`).sort().join("\n"));
const repeatedCurrent = {
  ...mixedCurrent,
  measuredAt: "2026-08-05T14:00:00.000Z",
  counts: { directories: 100, files: 1_300 },
  largestSubtrees: [
    { ...mixedCurrent.largestSubtrees[0], files: 220 },
    { ...mixedCurrent.largestSubtrees[1], files: 1_000 },
  ],
};
print(evaluateBoxGrowth({
  ...expectedRates,
  previous: expectedRates.current,
  current: repeatedCurrent,
}).some((item) => item.kind.startsWith("rate-")));
=>
true:true
acknowledge-box-growth,expect-box-growth-rates
rate-connector-files:150
rate-files:900
false
```

```ts cleanup
await mixedBox.cleanup();
```

Git history failure is reported as degraded measurement detail, not as box
growth, when the filesystem counters remain healthy.

```ts
const noGitBox = await makeTmpBox({ git: "none" });
const noGitMeasurement = {
  measuredAt: "2026-08-05T12:00:00.000Z",
  counts: { directories: 10, files: 20 },
  history: { status: "unavailable", error: "not a Git repository" },
  largestSubtrees: [],
};
await fs.mkdir(path.dirname(boxGrowthStatePath(noGitBox.root)), { recursive: true });
await fs.writeFile(boxGrowthStatePath(noGitBox.root), JSON.stringify({
  version: 1,
  status: "measured",
  previous: noGitMeasurement,
  current: noGitMeasurement,
  lastAttemptAt: noGitMeasurement.measuredAt,
  lastError: null,
  lastNotice: null,
}));
const noGitHealth = await boxGrowthHealthCheck(noGitBox.root, {
  now: at("2026-08-05T12:01:00Z"),
  schedulerStatus: "running",
});
print(`${noGitHealth.ok}:${noGitHealth.message.includes("Git history measurement is unavailable")}`);
=> true:true
```

```ts cleanup
await noGitBox.cleanup();
```
