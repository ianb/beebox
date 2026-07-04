# Reactor Integration Tests

Integration tests for the reactor with fake agents. Tests batch/chat
processing, lock management, and cycle behavior.

```ts setup
import {
  runReactor,
} from "../../src/core/reactor/index.js";
import { finishJob } from "../../src/core/finish-job.js";
import { createFakeAgent } from "../helpers/fake-agent.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { createIntakeJobTemplate } from "../../src/schemas/intake-job.js";
import { createChatJobTemplate } from "../../src/schemas/chat-job.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// Job cards are YAML frontmatter; build them with the real producer templates
// so these integration tests exercise the same shapes connectors write.
const intakeJob = (description, opts) =>
  createIntakeJobTemplate({
    created: "2026-07-01T00:00:00Z",
    source: "test",
    description,
    items: [],
    ...(opts ?? {}),
  });
const chatJob = (description, threadRef) =>
  createChatJobTemplate({
    created: "2026-07-01T00:00:00Z",
    source: "telegram",
    description,
    threadRef,
  });

// Override the reactor's slow real subsystems with no-ops. None of these
// tests assert on their effects, but each does real, expensive work per run:
//   - runSync / runFinalize spawn `cb wakeup` / `cb finalize` (a ~1s Node+tsx
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
await box.write("box/jobs/task.intake.job.card", intakeJob("Write a haiku"));
box.commitAll("Add job");

let fakeAgent;
const agentFactory = (opts) => {
  fakeAgent = createFakeAgent({
    name: opts.name,
    act: async ({ boxRoot }) => {
      await finishJob({ boxRoot, jobRelPath: "box/jobs/task.intake.job.card" });
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

// Agent was called
fakeAgent.invocations.length
=> 1

// System prompt includes box root
fakeAgent.invocations[0].systemPrompt.includes(box.root)
=> true

// User prompt includes job content
fakeAgent.invocations[0].prompt.includes("Write a haiku")
=> true

await box.cleanup();
```

### Multiple batch jobs in one session

```ts
const box = await makeTmpBox({ git: true });
await box.write("box/jobs/task1.intake.job.card", intakeJob("Task one"));
await box.write("box/jobs/task2.intake.job.card", intakeJob("Task two"));
box.commitAll("Add jobs");

let fakeAgent;
const agentFactory = (opts) => {
  fakeAgent = createFakeAgent({
    name: opts.name,
    act: async ({ boxRoot }) => {
      // Finish both jobs
      await finishJob({ boxRoot, jobRelPath: "box/jobs/task1.intake.job.card" });
      await finishJob({ boxRoot, jobRelPath: "box/jobs/task2.intake.job.card" });
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
await box.write("box/jobs/task.intake.job.card", intakeJob("Should not run"));
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
await box.write("box/jobs/digest.intake.job.card", intakeJob("Daily digest", { priority: "low" }));
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

## Chat processing with fake agent

### Chat job uses per-job agent with session

```ts
const box = await makeTmpBox({ git: true });
await box.write("store/threads/conv1.card", `---\nstatus: new\n---\nHi there`);
await box.write("box/jobs/msg.chat.job.card", chatJob("Reply to user", "store/threads/conv1.card"));
box.commitAll("Add chat job");

let agents = [];
const agentFactory = (opts) => {
  const agent = createFakeAgent({
    name: opts.name,
    sessionId: opts.sessionId,
    resume: opts.resume,
    act: async ({ boxRoot }) => {
      await finishJob({ boxRoot, jobRelPath: "box/jobs/msg.chat.job.card" });
      return { success: true };
    },
  });
  agents.push(agent);
  return agent;
};

const result = await runReactor({
  boxRoot: box.root,
  ...testOverrides,
  createAgent: agentFactory,
  type: "chat",
});

result.success
=> true

result.jobsProcessed
=> 1

// Agent was created with a session ID
agents.length
=> 1

agents[0].invocations[0].prompt.includes("Reply to user")
=> true

await box.cleanup();
```

### Multiple chat jobs get separate agent invocations

```ts
const box = await makeTmpBox({ git: true });
await box.write("store/threads/a.card", `---\nstatus: new\n---\nThread A`);
await box.write("store/threads/b.card", `---\nstatus: new\n---\nThread B`);
await box.write("box/jobs/a.chat.job.card", chatJob("Reply A", "store/threads/a.card"));
await box.write("box/jobs/b.chat.job.card", chatJob("Reply B", "store/threads/b.card"));
box.commitAll("Add chat jobs");

let agents = [];
const agentFactory = (opts) => {
  const jobFile = agents.length === 0 ? "a.chat.job.card" : "b.chat.job.card";
  const agent = createFakeAgent({
    name: opts.name,
    sessionId: opts.sessionId,
    resume: opts.resume,
    act: async ({ boxRoot }) => {
      await finishJob({ boxRoot, jobRelPath: `box/jobs/${jobFile}` });
      return { success: true };
    },
  });
  agents.push(agent);
  return agent;
};

const result = await runReactor({
  boxRoot: box.root,
  ...testOverrides,
  createAgent: agentFactory,
  type: "chat",
});

result.jobsProcessed
=> 2

// Each chat job got its own agent
agents.length
=> 2

await box.cleanup();
```

### Session resume across reactor cycles

A second message in the same thread must resume the session the first
cycle actually created. The fake agent enforces real SDK semantics via
`knownSessions`: resuming an id no earlier agent created fails with
"No conversation found" — so this test catches the store drifting from
the ids the SDK really knows about.

```ts
const box = await makeTmpBox({ git: true });
await box.write("store/threads/conv1.card", `---\nstatus: new\n---\nHi there`);
await box.write("box/jobs/msg1.chat.job.card", chatJob("First message", "store/threads/conv1.card"));
box.commitAll("Add first chat job");

const knownSessions = new Set();
let agents = [];
let jobToFinish = "msg1.chat.job.card";
const agentFactory = (opts) => {
  const agent = createFakeAgent({
    name: opts.name,
    sessionId: opts.sessionId,
    resume: opts.resume,
    knownSessions,
    act: async ({ boxRoot }) => {
      await finishJob({ boxRoot, jobRelPath: `box/jobs/${jobToFinish}` });
      return { success: true };
    },
  });
  agents.push(agent);
  return agent;
};

const reactorOpts = {
  boxRoot: box.root,
  ...testOverrides,
  createAgent: agentFactory,
  type: "chat",
};

const cycle1 = await runReactor(reactorOpts);
cycle1.success
=> true

// The stored session id is the id the agent actually created
const stored1 = JSON.parse(
  await fs.readFile(path.join(box.root, ".callback-box/chat-sessions.json"), "utf-8"),
);
stored1["store/threads/conv1.card"].sessionId === agents[0].sessionId
=> true

knownSessions.has(agents[0].sessionId)
=> true

// Second message in the same thread, next reactor cycle
await box.write("box/jobs/msg2.chat.job.card", chatJob("Second message", "store/threads/conv1.card"));
box.commitAll("Add second chat job");
jobToFinish = "msg2.chat.job.card";

const cycle2 = await runReactor(reactorOpts);
cycle2.success
=> true

cycle2.jobsProcessed
=> 1

// Cycle 2 resumed the exact session cycle 1 created
agents.length
=> 2

agents[1].sessionId === agents[0].sessionId
=> true

agents[1].invocations[0].resumed
=> true

// Session record survived and counted both messages
const stored2 = JSON.parse(
  await fs.readFile(path.join(box.root, ".callback-box/chat-sessions.json"), "utf-8"),
);
stored2["store/threads/conv1.card"].messageCount
=> 2

await box.cleanup();
```

## Lock management

### Lock prevents concurrent runs

```ts
const box = await makeTmpBox({ git: true });
const lockFile = path.join(box.root, ".cb-reactor.lock");
// Write a well-formed lock pointing at our own PID (treated as alive).
const liveHolder = {
  pid: process.pid,
  bootEpochSeconds: Math.floor(Date.now() / 1000 - os.uptime()),
  hostname: os.hostname(),
  acquiredAt: new Date().toISOString(),
  metadata: { kind: "reactor" },
};
await fs.writeFile(lockFile, JSON.stringify(liveHolder));

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
await fs.unlink(lockFile).catch(() => {});
await box.cleanup();
```

### Stale lock is cleaned up

```ts
const box = await makeTmpBox({ git: true });
const lockFile = path.join(box.root, ".cb-reactor.lock");
// Write a holder pointing at a dead PID — reactor should reclaim and run.
const deadHolder = {
  pid: 99999999,
  bootEpochSeconds: Math.floor(Date.now() / 1000 - os.uptime()),
  hostname: os.hostname(),
  acquiredAt: new Date().toISOString(),
  metadata: { kind: "reactor" },
};
await fs.writeFile(lockFile, JSON.stringify(deadHolder));

await box.write("box/jobs/task.intake.job.card", intakeJob("After stale lock"));
box.commitAll("Add job");

let fakeAgent;
const agentFactory = (opts) => {
  fakeAgent = createFakeAgent({
    name: opts.name,
    act: async ({ boxRoot }) => {
      await finishJob({ boxRoot, jobRelPath: "box/jobs/task.intake.job.card" });
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
await box.write("box/jobs/task1.intake.job.card", intakeJob("First task"));
await box.write("box/jobs/task2.intake.job.card", intakeJob("Second task"));
box.commitAll("Add jobs");

let cycle = 0;
const agentFactory = (opts) => {
  const currentCycle = cycle++;
  return createFakeAgent({
    name: opts.name,
    act: async ({ boxRoot }) => {
      // Each cycle finishes only one job
      const jobFile = currentCycle === 0 ? "task1.intake.job.card" : "task2.intake.job.card";
      await finishJob({ boxRoot, jobRelPath: `box/jobs/${jobFile}` });
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
