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
  acceptCurrentBoxGrowth,
  boxGrowthHealthCheck,
  evaluateBoxGrowth,
  measureBoxGrowth,
  measureBoxGrowthIfDue,
  readBoxGrowthState,
} from "../../src/core/box-growth/health.js";

const at = (iso) => new Date(iso);
```

## Tree counting, exclusions, attribution, and Git

```ts
const box = await makeTmpBox({ git: true });
await box.write("box/inbox/email/thread/message.txt", "mail");
await box.write("store/chat/session/transcript.md", "chat");
await box.write("tmp-upload/image.jpg", "image");
await box.write(".callback-box/ignored.txt", "state");
await fs.mkdir(box.path("node_modules/pkg"), { recursive: true });
await fs.writeFile(box.path("node_modules/pkg/index.js"), "ignored");
await fs.symlink(box.path("box"), box.path("box-link"));
box.commitAll("seed growth fixture");

const measured = await measureBoxGrowth(box.root, { now: at("2026-08-05T12:00:00Z") });
print(`directories: ${measured.counts.directories}`);
print(`files: ${measured.counts.files}`);
print(`history: ${measured.history.status}`);
print(measured.largestSubtrees.filter((item) => item.files > 0).map((item) => `${item.path}:${item.source}:${item.files}`).join("\n"));
=>
directories: 8
files: 4
history: available
box/inbox/email:connector:1
store/chat/session:chat:1
tmp-upload:user-input:1
.cb-box:unknown:1

measured.largestSubtrees.length <= 20
=> true
```

```ts cleanup
await box.cleanup();
```

## Absolute, hourly, and connector-weighted policy

```ts
const base = {
  measuredAt: "2026-08-05T12:00:00.000Z",
  counts: { directories: 100, files: 100 },
  history: { status: "available", gitHead: "a", commits: 10, gitObjects: 20, gitBytes: 30 },
  largestSubtrees: [{ path: "box/inbox/email", directories: 20, files: 20, source: "connector", sourceLabel: "Gmail" }],
};
const fast = {
  ...base,
  measuredAt: "2026-08-05T13:00:00.000Z",
  counts: { directories: 210, files: 210 },
  history: { ...base.history, commits: 111 },
  largestSubtrees: [{ ...base.largestSubtrees[0], directories: 121, files: 121 }],
};
const findings = evaluateBoxGrowth({ accepted: base, previous: base, current: fast });
print(findings.map((finding) => `${finding.kind}:${finding.path ?? "box"}`).join("\n"));
=>
rate-commits:box
rate-connector-directories:box/inbox/email
rate-connector-files:box/inbox/email

const absolute = { ...fast, counts: { directories: BOX_GROWTH_THRESHOLDS.absoluteDirectories + 1, files: 1 } };
const absoluteFinding = evaluateBoxGrowth({ accepted: base, previous: base, current: absolute })
  .find((item) => item.kind === "absolute-directories");
print(`${absoluteFinding !== undefined}:${absoluteFinding?.path}`);
=> true:box/inbox/email

evaluateBoxGrowth({ accepted: absolute, previous: absolute, current: absolute, acknowledgedAt: null }).some((item) => item.kind === "absolute-directories")
=> true

const enteredTopTwenty = { ...fast, largestSubtrees: [{ ...fast.largestSubtrees[0], path: "store/drive" }] };
evaluateBoxGrowth({ accepted: base, previous: base, current: enteredTopTwenty }).some((item) => item.kind.startsWith("rate-connector"))
=> false
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
=>
measured
skipped
measured
.callback-box/box-growth-health.json

await box.write("box/inbox/email/new/message.txt", "mail");
await measureBoxGrowthIfDue(box.root, { now: at("2026-08-05T13:00:00Z") });
const accepted = await acceptCurrentBoxGrowth(box.root, { now: at("2026-08-05T13:01:00Z") });
print(accepted.status);
print(accepted.status === "measured" && accepted.accepted.measuredAt === accepted.current.measuredAt);
const health = await boxGrowthHealthCheck(box.root, { now: at("2026-08-05T13:01:00Z"), schedulerStatus: "running" });
print(`${health.name}:${health.ok}:${health.action ?? "none"}`);
=>
measured
true
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

const failed = await measureBoxGrowthIfDue(corrupt.root, {
  now: at("2026-08-05T13:00:00Z"),
  maxDurationMs: 0,
});
print(failed.status);
const failedState = await readBoxGrowthState(corrupt.root);
print(`${failedState.status}:${failedState.lastError !== null}`);
=>
false:true
failed
unmeasured:true
```

```ts cleanup
await corrupt.cleanup();
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

An above-threshold state names its largest subtree and exposes the explicit
acknowledgement action.

```ts
const warningBox = await makeTmpBox();
const warningMeasurement = {
  measuredAt: "2026-08-05T12:00:00.000Z",
  counts: { directories: 20_000, files: 1_000 },
  history: { status: "available", gitHead: "head", commits: 10, gitObjects: 20, gitBytes: 30 },
  largestSubtrees: [{ path: "box/inbox/email", directories: 19_000, files: 900, source: "connector", sourceLabel: "Gmail" }],
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
print(`${warningHealth.ok}:${warningHealth.action}:${warningHealth.message.includes("box/inbox/email")}`);
=> false:accept-box-growth:true
```

```ts cleanup
await warningBox.cleanup();
```
