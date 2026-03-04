# Reactor Integration Tests

Integration tests for the reactor with fake agents. Tests batch/chat
processing, procedure trampoline, lock management, and cycle behavior.

```ts setup
import {
  runReactor,
} from "../src/core/reactor/index.js";
import { finishJob } from "../src/core/finish-job.js";
import { createFakeAgent } from "./helpers/fake-agent.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
```

## Batch processing with fake agent

### Single batch job processed by agent

```
const box = await makeTmpBox({ git: true });
await box.write("box/jobs/task.job.card", `<job><description>Write a haiku</description></job>`);
box.commitAll("Add job");

let fakeAgent;
const agentFactory = (opts) => {
  fakeAgent = createFakeAgent({
    name: opts.name,
    act: async ({ boxRoot }) => {
      await finishJob({ boxRoot, jobRelPath: "box/jobs/task.job.card" });
      return { success: true };
    },
  });
  return fakeAgent;
};

const result = await runReactor({
  boxRoot: box.root,
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

```
const box = await makeTmpBox({ git: true });
await box.write("box/jobs/task1.job.card", `<job><description>Task one</description></job>`);
await box.write("box/jobs/task2.job.card", `<job><description>Task two</description></job>`);
box.commitAll("Add jobs");

let fakeAgent;
const agentFactory = (opts) => {
  fakeAgent = createFakeAgent({
    name: opts.name,
    act: async ({ boxRoot }) => {
      // Finish both jobs
      await finishJob({ boxRoot, jobRelPath: "box/jobs/task1.job.card" });
      await finishJob({ boxRoot, jobRelPath: "box/jobs/task2.job.card" });
      return { success: true };
    },
  });
  return fakeAgent;
};

const result = await runReactor({
  boxRoot: box.root,
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

```
const box = await makeTmpBox({ git: true });
await box.write("box/jobs/task.job.card", `<job><description>Should not run</description></job>`);
box.commitAll("Add job");

let agentCreated = false;
const agentFactory = (opts) => {
  agentCreated = true;
  return createFakeAgent({ name: opts.name, act: async () => ({ success: true }) });
};

const result = await runReactor({
  boxRoot: box.root,
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

```
const box = await makeTmpBox({ git: true });
await box.write("box/jobs/digest.job.card", `<job priority="low"><description>Daily digest</description></job>`);
box.commitAll("Add low-pri job");

let agentCreated = false;
const agentFactory = (opts) => {
  agentCreated = true;
  return createFakeAgent({ name: opts.name, act: async () => ({ success: true }) });
};

const result = await runReactor({
  boxRoot: box.root,
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

```
const box = await makeTmpBox({ git: true });
await box.write("store/threads/conv1.card", `<thread><message role="user">Hi there</message></thread>`);
await box.write("box/jobs/msg.chat.job.card", `<chat-job><thread ref="store/threads/conv1.card" /><description>Reply to user</description></chat-job>`);
box.commitAll("Add chat job");

let agents = [];
const agentFactory = (opts) => {
  const agent = createFakeAgent({
    name: opts.name,
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

```
const box = await makeTmpBox({ git: true });
await box.write("store/threads/a.card", `<thread><message>Thread A</message></thread>`);
await box.write("store/threads/b.card", `<thread><message>Thread B</message></thread>`);
await box.write("box/jobs/a.chat.job.card", `<chat-job><thread ref="store/threads/a.card" /><description>Reply A</description></chat-job>`);
await box.write("box/jobs/b.chat.job.card", `<chat-job><thread ref="store/threads/b.card" /><description>Reply B</description></chat-job>`);
box.commitAll("Add chat jobs");

let agents = [];
const agentFactory = (opts) => {
  const jobFile = agents.length === 0 ? "a.chat.job.card" : "b.chat.job.card";
  const agent = createFakeAgent({
    name: opts.name,
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

## Procedure trampoline

### Procedure job bypasses agent entirely

```
const box = await makeTmpBox({ git: true });
await box.write("config/procedures/simple.procedure.card", `
<procedure name="simple">
  <step id="do-it">
    <run><shell>true</shell></run>
  </step>
</procedure>
`);
await box.write("box/jobs/run-proc.job.card", `<job><procedure ref="simple" /></job>`);
box.commitAll("Add procedure job");

let agentCreated = false;
const agentFactory = (opts) => {
  agentCreated = true;
  return createFakeAgent({ name: opts.name, act: async () => ({ success: true }) });
};

const logs = [];
const result = await runReactor({
  boxRoot: box.root,
  createAgent: agentFactory,
  onLog: (text) => logs.push(text),
});

// Procedure ran without creating an agent
agentCreated
=> false
result.success
=> true
result.jobsProcessed
=> 1
result.jobsRemaining
=> 0
await box.cleanup();
```

## Lock management

### Lock prevents concurrent runs

```
const box = await makeTmpBox({ git: true });
const lockFile = path.join(box.root, ".cb-reactor.lock");
// Write lock with our own PID (will be seen as "alive")
await fs.writeFile(lockFile, String(process.pid));

const result = await runReactor({
  boxRoot: box.root,
  createAgent: (opts) => createFakeAgent({ name: opts.name, act: async () => ({ success: true }) }),
});

// Reactor bailed due to lock
result.jobsProcessed
=> 0

// Clean up lock
await fs.unlink(lockFile);
await box.cleanup();
```

### Stale lock is cleaned up

```
const box = await makeTmpBox({ git: true });
const lockFile = path.join(box.root, ".cb-reactor.lock");
// Write lock with a dead PID
await fs.writeFile(lockFile, "99999999");

await box.write("box/jobs/task.job.card", `<job><description>After stale lock</description></job>`);
box.commitAll("Add job");

let fakeAgent;
const agentFactory = (opts) => {
  fakeAgent = createFakeAgent({
    name: opts.name,
    act: async ({ boxRoot }) => {
      await finishJob({ boxRoot, jobRelPath: "box/jobs/task.job.card" });
      return { success: true };
    },
  });
  return fakeAgent;
};

const result = await runReactor({
  boxRoot: box.root,
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

```
const box = await makeTmpBox({ git: true });
await box.write("box/jobs/task1.job.card", `<job><description>First task</description></job>`);
await box.write("box/jobs/task2.job.card", `<job><description>Second task</description></job>`);
box.commitAll("Add jobs");

let cycle = 0;
const agentFactory = (opts) => {
  const currentCycle = cycle++;
  return createFakeAgent({
    name: opts.name,
    act: async ({ boxRoot }) => {
      // Each cycle finishes only one job
      const jobFile = currentCycle === 0 ? "task1.job.card" : "task2.job.card";
      await finishJob({ boxRoot, jobRelPath: `box/jobs/${jobFile}` });
      return { success: true };
    },
  });
};

const result = await runReactor({
  boxRoot: box.root,
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
