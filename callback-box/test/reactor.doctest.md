# Reactor (Prompt Tests)

Tests for the reactor's prompt building functions. The reactor orchestrates
job processing with agents, but agent injection isn't supported yet (the
reactor manages its own agent sessions internally). These tests verify
the prompts that get sent to agents.

```ts setup
import {
  buildReactorSystemPrompt,
  buildReactorUserPrompt,
} from "../src/core/reactor.js";
```

## buildReactorSystemPrompt

### Includes working directory and key instructions

```
const prompt = buildReactorSystemPrompt("/test/box");
prompt.includes("WORKING DIRECTORY: /test/box")
=> true
prompt.includes("processing jobs in a Callback Box")
=> true
prompt.includes("cb finish")
=> true
prompt.includes("DO NOT re-read these")
=> true
```

## buildReactorUserPrompt

### Formats job list with descriptions

```
const prompt = buildReactorUserPrompt(
  ["box/jobs/task1.job.card", "box/jobs/task2.job.card"],
  ["### box/jobs/task1.job.card\n```xml\n<job>do thing 1</job>\n```",
   "### box/jobs/task2.job.card\n```xml\n<job>do thing 2</job>\n```"],
);
prompt.includes("2 job(s)")
=> true
prompt.includes("do thing 1")
=> true
prompt.includes("do thing 2")
=> true
prompt.includes("cb finish")
=> true
```

### Single job

```
const prompt = buildReactorUserPrompt(
  ["box/jobs/only.job.card"],
  ["### box/jobs/only.job.card\n```xml\n<job>solo task</job>\n```"],
);
prompt.includes("1 job(s)")
=> true
prompt.includes("solo task")
=> true
```
