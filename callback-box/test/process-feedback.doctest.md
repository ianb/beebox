# Process Feedback (Agent Tests)

Tests for the `process-feedback` command, which invokes an agent to revise
the news guide based on accumulated reader feedback. Uses a fake agent to verify:
- The prompt and context given to the agent
- Brief discovery (which briefs need processing)
- Post-agent behavior (commit checking, lock release)
- Handling of agent failure

```ts setup
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import { createFakeAgent } from "./helpers/fake-agent.js";
import { initBox } from "../src/core/box.js";
import type { CommandContext } from "../src/core/command-runner.js";
import {
  executeProcessFeedback,
  getUnprocessedBriefs,
  buildGuideRevisionPrompt,
} from "../src/core/commands/process-feedback.js";
function makeCtx(boxRoot: string): CommandContext {
  return {
    boxRoot,
    write: () => {},
    writeLine: () => {},
  };
}
```

## getUnprocessedBriefs

### Finds briefs without guide-revision attr

Only briefs in `store/archive/briefs/` missing the `guide-revision` attribute
are returned. Briefs that have already been processed are skipped.

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);

// Brief without guide-revision — should be included
await box.seed("store/archive/briefs/2026-02-03_ai.news-brief.card",
  `<news-brief overall-rating="great" read-at="2026-02-03T12:00:00Z">
  <content>AI news</content>
</news-brief>`);

// Brief with guide-revision — already processed, skip
await box.seed("store/archive/briefs/2026-02-01_security.news-brief.card",
  `<news-brief overall-rating="ok" guide-revision="2026-02-02T00:00:00Z">
  <content>Security news</content>
</news-brief>`);

// Brief without rating (not yet read) but also no guide-revision — included
await box.seed("store/archive/briefs/2026-02-04_tech.news-brief.card",
  `<news-brief>
  <content>Tech news</content>
</news-brief>`);

const briefs = await getUnprocessedBriefs(box.root);
briefs.sort();
print(briefs.join("\n"));
=>
store/archive/briefs/2026-02-03_ai.news-brief.card
store/archive/briefs/2026-02-04_tech.news-brief.card
```

### Returns empty when no briefs directory exists

```
const box = await makeTmpBox({ git: true });
const briefs = await getUnprocessedBriefs(box.root);
briefs.length
=> 0
```

### Returns empty when all briefs are processed

```
const box = await makeTmpBox({ git: true });
await box.seed("store/archive/briefs/2026-02-03_ai.news-brief.card",
  `<news-brief guide-revision="2026-02-03T00:00:00Z">done</news-brief>`);

const briefs = await getUnprocessedBriefs(box.root);
briefs.length
=> 0
```

## buildGuideRevisionPrompt

### Produces the expected system prompt

The prompt is parameterized by boxRoot. Key sections verified here.

```
const prompt = buildGuideRevisionPrompt("/test/box");
prompt.startsWith("You are revising the news guide")
=> true
prompt.includes("WORKING DIRECTORY: /test/box")
=> true
prompt.includes("STEP 1 - READ THE GUIDE")
=> true
prompt.includes("STEP 2 - READ EACH BRIEF")
=> true
prompt.includes("STEP 3 - SYNTHESIZE ALL FEEDBACK")
=> true
prompt.includes("STEP 4 - UPDATE THE GUIDE")
=> true
prompt.includes("STEP 5 - MARK BRIEFS AS PROCESSED")
=> true
prompt.includes("STEP 6 - COMMIT WITH DETAILED MESSAGE")
=> true
prompt.includes("Do NOT add Co-Authored-By")
=> true
```

## executeProcessFeedback with fake agent

### Happy path — agent receives correct prompt and commits

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed("store/archive/briefs/2026-02-03_ai.news-brief.card",
  `<news-brief overall-rating="great" read-at="2026-02-03T12:00:00Z">
  <content>AI news</content>
</news-brief>`);
box.commitAll("add brief");

const agent = createFakeAgent({
  name: "guide-revision",
  act: async ({ boxRoot }) => {
    // Simulate: agent updates the guide and marks brief as processed
    execSync([
      "mkdir -p config",
      'echo "<guide>updated</guide>" > config/news.guide.card',
      "git add -A",
      'git commit -m "Guide revision: AI feedback"',
    ].join(" && "), { cwd: boxRoot, stdio: "pipe" });
    return { success: true };
  },
});

const result = await executeProcessFeedback(makeCtx(box.root), { agent, force: true });
result.success
=> true
result.data.processed
=> 1

// Agent was invoked exactly once
agent.invocations.length
=> 1

// System prompt was provided
const inv = agent.invocations[0];
inv.systemPrompt.startsWith("You are revising the news guide")
=> true
inv.systemPrompt.includes("WORKING DIRECTORY: " + box.root)
=> true

// User prompt lists the unprocessed brief
inv.prompt.includes("store/archive/briefs/2026-02-03_ai.news-brief.card")
=> true
```

### Multiple unprocessed briefs — all listed in prompt

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed("store/archive/briefs/2026-02-03_ai.news-brief.card",
  `<news-brief overall-rating="great">AI</news-brief>`);
await box.seed("store/archive/briefs/2026-02-04_tech.news-brief.card",
  `<news-brief overall-rating="ok">Tech</news-brief>`);
box.commitAll("add briefs");

const agent = createFakeAgent({
  name: "guide-revision",
  act: async ({ boxRoot }) => {
    execSync("git commit --allow-empty -m 'Guide revision'", {
      cwd: boxRoot, stdio: "pipe",
    });
    return { success: true };
  },
});

const result = await executeProcessFeedback(makeCtx(box.root), { agent, force: true });
result.data.processed
=> 2

// Both briefs mentioned in the prompt
const inv = agent.invocations[0];
inv.prompt.includes("2026-02-03_ai.news-brief.card")
=> true
inv.prompt.includes("2026-02-04_tech.news-brief.card")
=> true
```

### No unprocessed briefs — skips agent entirely

When there are no briefs to process, the agent should not be invoked.

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

// Only processed briefs exist
await box.seed("store/archive/briefs/2026-02-01_old.news-brief.card",
  `<news-brief guide-revision="2026-02-02T00:00:00Z">done</news-brief>`);

const agent = createFakeAgent({
  name: "guide-revision",
  act: async () => {
    throw new Error("Should not be called");
  },
});

const result = await executeProcessFeedback(makeCtx(box.root), { agent, force: true });
result.success
=> true
result.data.processed
=> 0

agent.invocations.length
=> 0
```

### Agent fails — returns error

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed("store/archive/briefs/2026-02-03_ai.news-brief.card",
  `<news-brief overall-rating="meh">AI</news-brief>`);
box.commitAll("add brief");

const agent = createFakeAgent({
  name: "guide-revision",
  act: async () => {
    return { success: false, error: "Agent crashed" };
  },
});

const result = await executeProcessFeedback(makeCtx(box.root), { agent, force: true });
result.success
=> false
result.error
=> Agent crashed
```

### Agent doesn't commit — fallback commit created

When the agent succeeds but forgets to commit, ensureAgentCommitted retries
then creates a fallback commit.

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed("store/archive/briefs/2026-02-03_ai.news-brief.card",
  `<news-brief overall-rating="great">AI</news-brief>`);
box.commitAll("add brief");

// Create a tracked file so modifying it shows as "modified" (not untracked)
await box.seed("config/news.guide.card", "<guide>original</guide>");
box.commitAll("add guide");

const agent = createFakeAgent({
  name: "guide-revision",
  act: async ({ boxRoot, invocation }) => {
    if (invocation === 0) {
      // Agent modifies a tracked file but forgets to commit
      execSync('echo "<guide>updated</guide>" > config/news.guide.card', {
        cwd: boxRoot, stdio: "pipe",
      });
      return { success: true };
    }
    // Retry nudge — still doesn't commit
    return { success: true };
  },
});

const result = await executeProcessFeedback(makeCtx(box.root), { agent, force: true });
result.success
=> true

// Two invocations: original + retry nudge
agent.invocations.length
=> 2

// Second invocation was a resume
agent.invocations[1].resumed
=> true
agent.invocations[1].systemPrompt
=> null

// Fallback commit was created
const fullLog = execSync("git log -1 --format=%B", { cwd: box.root, encoding: "utf-8" });
fullLog.includes("Fallback: true")
=> true
```

### Dry run — reports briefs without invoking agent

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed("store/archive/briefs/2026-02-03_ai.news-brief.card",
  `<news-brief overall-rating="great">AI</news-brief>`);

const agent = createFakeAgent({
  name: "guide-revision",
  act: async () => {
    throw new Error("Should not be called in dry run");
  },
});

const result = await executeProcessFeedback(makeCtx(box.root), { agent, force: true, dryRun: true });
result.success
=> true
result.data.dryRun
=> true
result.data.processed
=> 0

agent.invocations.length
=> 0
```
