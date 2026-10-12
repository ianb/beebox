# Reactor Integration Tests

Integration tests for the reactor with fake agents. Tests batch
processing, lock management, and cycle behavior.

```ts setup
import {
  runReactor,
} from "../../../src/core/reactor/engine/core.js";
import { finishJob } from "../../../src/core/finish-job.js";
import { createFakeAgent } from "../fake-agent.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { createIntakeJobTemplate } from "../../../src/schemas/intake-job.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// Job cards are YAML frontmatter; build them with the real producer templates
// so these integration tests exercise the same shapes connectors write.
const intakeJob = (description, opts) =>
  createIntakeJobTemplate({
    created: "2026-07-01T00:00:00Z",
    description,
    items: [],
    ...(opts ?? {}),
  });

// Override the reactor's slow real subsystems with no-ops. None of these
// tests assert on their effects, but each does real, expensive work per run:
//   - runSync / runFinalize spawn `bbx wakeup` / `bbx finalize` (a ~1s Node+tsx
//     cold start each, no-opping on an empty test box)
//   - generateDocs regenerates agent docs (~1s cold on a fresh box)
// Faking them keeps these tests in-process, fast, and deterministic.
const testOverrides = {
  runSync: async () => true,
  runFinalize: async () => true,
  generateDocs: async () => {},
};
```

## Batch processing with fake agent

### Single batch job processed by agent

```ts
const box = await makeTmpBox({ git: true });
await box.write("_bookkeeping/jobs/task.intake.job.card", intakeJob("Write a haiku"));
box.commitAll("Add job");

let fakeAgent;
const agentFactory = (opts) => {
  fakeAgent = createFakeAgent({
    name: opts.name,
    act: async ({ boxRoot }) => {
      await finishJob({ boxRoot, jobRelPath: "_bookkeeping/jobs/task.intake.job.card" });
      return { success: true };
    },
  });
  return fakeAgent;
};

const result = await runReactor({
  boxRoot: box.root,
  ...testOverrides,
  createAgent: agentFactory,
});

result.success
=> true

result.jobsProcessed
=> 1

result.jobsRemaining
=> 0

// System prompt no longer carries the absolute box path (dropped so it
// doesn't leak this machine's temp/home directory into agent context).
fakeAgent.invocations[0].systemPrompt.includes(box.root)
=> false

await box.cleanup();
```

### Multiple batch jobs in one session

```ts
const box = await makeTmpBox({ git: true });
await box.write("_bookkeeping/jobs/task1.intake.job.card", intakeJob("Task one"));
await box.write("_bookkeeping/jobs/task2.intake.job.card", intakeJob("Task two"));
box.commitAll("Add jobs");

let fakeAgent;
const agentFactory = (opts) => {
  fakeAgent = createFakeAgent({
    name: opts.name,
    act: async ({ boxRoot }) => {
      // Finish both jobs
      await finishJob({ boxRoot, jobRelPath: "_bookkeeping/jobs/task1.intake.job.card" });
      await finishJob({ boxRoot, jobRelPath: "_bookkeeping/jobs/task2.intake.job.card" });
      return { success: true };
    },
  });
  return fakeAgent;
};

const result = await runReactor({
  boxRoot: box.root,
  ...testOverrides,
  createAgent: agentFactory,
});

result.jobsProcessed
=> 2

// Single agent session (one invocation with both jobs)
fakeAgent.invocations.length
=> 1

fakeAgent.invocations[0].prompt.includes("Task one")
=> true

fakeAgent.invocations[0].prompt.includes("Task two")
=> true

await box.cleanup();
```

### Dry run does not invoke agent

```ts
const box = await makeTmpBox({ git: true });
await box.write("_bookkeeping/jobs/task.intake.job.card", intakeJob("Should not run"));
box.commitAll("Add job");

let agentCreated = false;
const agentFactory = (opts) => {
  agentCreated = true;
  return createFakeAgent({ name: opts.name, act: async () => ({ success: true }) });
};

const result = await runReactor({
  boxRoot: box.root,
  ...testOverrides,
  createAgent: agentFactory,
  dryRun: true,
});

agentCreated
=> false

result.jobsProcessed
=> 0

await box.cleanup();
```

### skipLowPriority skips when only low-priority jobs exist

```ts
const box = await makeTmpBox({ git: true });
await box.write("_bookkeeping/jobs/digest.intake.job.card", intakeJob("Daily digest", { priority: "low" }));
box.commitAll("Add low-pri job");

let agentCreated = false;
const agentFactory = (opts) => {
  agentCreated = true;
  return createFakeAgent({ name: opts.name, act: async () => ({ success: true }) });
};

const result = await runReactor({
  boxRoot: box.root,
  ...testOverrides,
  createAgent: agentFactory,
  skipLowPriority: true,
});

agentCreated
=> false

result.jobsRemaining
=> 1

await box.cleanup();
```

## Lock management

### Lock prevents concurrent runs

```ts
const box = await makeTmpBox({ git: true });
const lockFile = path.join(box.root, ".bbx-reactor.lock");
// Simulate a live holder in another process: a fresh guard directory (what
// proper-lockfile mkdir-locks) plus its diagnostic sidecar.
await fs.mkdir(lockFile + ".guard");
await fs.writeFile(lockFile, JSON.stringify({
  pid: process.pid,
  hostname: os.hostname(),
  acquiredAt: new Date().toISOString(),
  metadata: { kind: "reactor" },
}));

const result = await runReactor({
  boxRoot: box.root,
  ...testOverrides,
  createAgent: (opts) => createFakeAgent({ name: opts.name, act: async () => ({ success: true }) }),
});

// Reactor bailed due to lock
result.jobsProcessed
=> 0
```

```ts cleanup
await fs.rm(lockFile + ".guard", { recursive: true, force: true });
await fs.unlink(lockFile).catch(() => {});
await box.cleanup();
```

### Stale lock is cleaned up

```ts
const box = await makeTmpBox({ git: true });
const lockFile = path.join(box.root, ".bbx-reactor.lock");
// Simulate a crashed holder: a guard directory whose mtime is well past the
// stale window (5 min). proper-lockfile reclaims it on the next acquire.
await fs.mkdir(lockFile + ".guard");
const past = new Date(Date.now() - 10 * 60 * 1000);
await fs.utimes(lockFile + ".guard", past, past);
await fs.writeFile(lockFile, JSON.stringify({
  pid: 99999999,
  hostname: os.hostname(),
  acquiredAt: past.toISOString(),
  metadata: { kind: "reactor" },
}));

await box.write("_bookkeeping/jobs/task.intake.job.card", intakeJob("After stale lock"));
box.commitAll("Add job");

let fakeAgent;
const agentFactory = (opts) => {
  fakeAgent = createFakeAgent({
    name: opts.name,
    act: async ({ boxRoot }) => {
      await finishJob({ boxRoot, jobRelPath: "_bookkeeping/jobs/task.intake.job.card" });
      return { success: true };
    },
  });
  return fakeAgent;
};

const result = await runReactor({
  boxRoot: box.root,
  ...testOverrides,
  createAgent: agentFactory,
});

// Stale lock was cleaned up and reactor ran
result.jobsProcessed
=> 1

await box.cleanup();
```

## Cycle loop

### Multiple cycles process remaining jobs

The reactor loops when jobs remain after a cycle. Here we start with
2 jobs but the agent only finishes 1 per invocation, requiring 2 cycles.

```ts
const box = await makeTmpBox({ git: true });
await box.write("_bookkeeping/jobs/task1.intake.job.card", intakeJob("First task"));
await box.write("_bookkeeping/jobs/task2.intake.job.card", intakeJob("Second task"));
box.commitAll("Add jobs");

let cycle = 0;
const agentFactory = (opts) => {
  const currentCycle = cycle++;
  return createFakeAgent({
    name: opts.name,
    act: async ({ boxRoot }) => {
      // Each cycle finishes only one job
      const jobFile = currentCycle === 0 ? "task1.intake.job.card" : "task2.intake.job.card";
      await finishJob({ boxRoot, jobRelPath: `_bookkeeping/jobs/${jobFile}` });
      return { success: true };
    },
  });
};

const result = await runReactor({
  boxRoot: box.root,
  ...testOverrides,
  createAgent: agentFactory,
  maxCycles: 3,
});

result.jobsProcessed
=> 2

result.jobsRemaining
=> 0

// Two cycles were needed
cycle
=> 2

await box.cleanup();
```
