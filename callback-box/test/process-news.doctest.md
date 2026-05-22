# Process News (Agent Tests)

Tests for the `process-news` command, which processes news through multiple
phases (triage, fetch, analyze, brief). Uses a fake agent and phase-only
flags to test each agent phase in isolation.

```ts setup
import { join } from "node:path";
import { execSync } from "node:child_process";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import { createFakeAgent } from "./helpers/fake-agent.js";
import { initBox } from "../src/core/box.js";
import type { CommandContext } from "../src/core/command-runner.js";
import {
  executeProcessNews,
  getNewsFromDir,
  buildNewsTriagePrompt,
  buildAnalyzePrompt,
  buildBriefPrompt,
} from "../src/core/commands/process-news.js";
function makeCtx(boxRoot: string): CommandContext {
  return {
    boxRoot,
    write: () => {},
    writeLine: () => {},
  };
}
```

## getNewsFromDir

### Finds news item cards in a directory

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);

await box.seed("box/inbox/news/Article_One.news-item.card", "<news-item>one</news-item>");
await box.seed("box/inbox/news/Article_Two.news-item.card", "<news-item>two</news-item>");
await box.seed("box/inbox/news/not-a-card.txt", "ignore me");

const items = await getNewsFromDir(box.root, "box/inbox/news");
items.sort();
print(items.join("\n"));
=>
box/inbox/news/Article_One.news-item.card
box/inbox/news/Article_Two.news-item.card
```

### Returns empty when directory doesn't exist

```
const box = await makeTmpBox({ git: true });
const items = await getNewsFromDir(box.root, "box/inbox/news");
items.length
=> 0
```

## Prompt builders

### Triage prompt includes guide content and select count

```
const prompt = buildNewsTriagePrompt({
  guideContent: "<guide>AI, security</guide>",
  selectCount: 15,
  boxRoot: "/test/box",
});
prompt.includes("WORKING DIRECTORY: /test/box")
=> true

prompt.includes("<guide>AI, security</guide>")
=> true

prompt.includes("select the 15 most interesting")
=> true
```

### Triage prompt with no guide uses default criteria

```
const prompt = buildNewsTriagePrompt({
  guideContent: null,
  selectCount: 10,
  boxRoot: "/test/box",
});
prompt.includes("general interest criteria")
=> true
```

### Analyze prompt includes working directory

```
const prompt = buildAnalyzePrompt("/test/box");
prompt.includes("WORKING DIRECTORY: /test/box")
=> true

prompt.includes("STEP 1 - READ AND ANALYZE")
=> true

prompt.includes("cb mv")
=> true
```

### Brief prompt includes working directory and guidelines

```
const prompt = buildBriefPrompt("/test/box");
prompt.includes("WORKING DIRECTORY: /test/box")
=> true

prompt.includes("STEP 0 - READ OR CREATE THE USER GUIDE")
=> true

prompt.includes("STEP 3 - CREATE THE BRIEF")
=> true

prompt.includes("Do NOT add Co-Authored-By")
=> true
```

## Triage phase (triageOnly)

### Happy path — agent triages items and commits

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed("box/inbox/news/AI_Research.news-item.card", "<news-item>AI</news-item>");
await box.seed("box/inbox/news/Boring_Press.news-item.card", "<news-item>boring</news-item>");
box.commitAll("add news");

const agent = createFakeAgent({
  name: "news-triage",
  act: async ({ boxRoot }) => {
    // Simulate: agent trashes one item and commits
    execSync([
      "mkdir -p store/trash/news",
      "mv box/inbox/news/Boring_Press.news-item.card store/trash/news/",
      "git add -A",
      'git commit -m "Triage: kept 1/2 items"',
    ].join(" && "), { cwd: boxRoot, stdio: "pipe" });
    return { success: true };
  },
});

const result = await executeProcessNews(makeCtx(box.root), {
  agent, force: true, triageOnly: true,
});
result.success
=> true

// Agent was invoked once for triage
agent.invocations.length
=> 1

// System prompt mentions triaging news
const inv = agent.invocations[0];
inv.systemPrompt.includes("triaging news items")
=> true

// User prompt mentions the item count
inv.prompt.includes("2 news items")
=> true

// Model set to haiku for triage
```

### No items in inbox — skips agent

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

const agent = createFakeAgent({
  name: "news-triage",
  act: async () => {
    throw new Error("Should not be called");
  },
});

const result = await executeProcessNews(makeCtx(box.root), {
  agent, force: true, triageOnly: true,
});
result.success
=> true

agent.invocations.length
=> 0
```

## Analyze phase (analyzeOnly)

### Agent receives correct prompt and commits

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed("box/inbox/news/AI_Research.news-item.card",
  "---\ntype: news-item\ntitle: AI Research\nlink: https://example.com/ai\npublished: 2026-02-01T00:00:00Z\n---\nFull article text here\n");
box.commitAll("add news with content");

const agent = createFakeAgent({
  name: "news-analyze",
  act: async ({ boxRoot }) => {
    execSync([
      "mkdir -p box/pool/news",
      "mv box/inbox/news/AI_Research.news-item.card box/pool/news/",
      "git add -A",
      'git commit -m "Analyze 1 item"',
    ].join(" && "), { cwd: boxRoot, stdio: "pipe" });
    return { success: true };
  },
});

const result = await executeProcessNews(makeCtx(box.root), {
  agent, force: true, analyzeOnly: true,
});
result.success
=> true

agent.invocations.length
=> 1

// System prompt is the analyze prompt
agent.invocations[0].systemPrompt.includes("analyzing news articles")
=> true

// User prompt lists the item
agent.invocations[0].prompt.includes("AI_Research.news-item.card")
=> true
```

## Brief phase (briefOnly)

### Agent receives correct prompt when pool has items

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed("box/pool/news/AI_Research.news-item.card",
  `<news-item><analysis>topics: AI</analysis></news-item>`);
box.commitAll("add pool item");

const agent = createFakeAgent({
  name: "news-brief",
  act: async ({ boxRoot }) => {
    execSync([
      "mkdir -p box/output/briefs store/archive/news",
      'echo "<news-brief><title>AI Update</title></news-brief>" > box/output/briefs/2026-02-03_ai.news-brief.card',
      "mv box/pool/news/AI_Research.news-item.card store/archive/news/",
      "git add -A",
      'git commit -m "Brief: AI Update"',
    ].join(" && "), { cwd: boxRoot, stdio: "pipe" });
    return { success: true };
  },
});

const result = await executeProcessNews(makeCtx(box.root), {
  agent, force: true, briefOnly: true,
});
result.success
=> true

agent.invocations.length
=> 1

// System prompt is the brief prompt
agent.invocations[0].systemPrompt.includes("creating a personal news brief")
=> true

// User prompt mentions pool
agent.invocations[0].prompt.includes("box/pool/news")
=> true
```

### No items in pool — skips agent

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

const agent = createFakeAgent({
  name: "news-brief",
  act: async () => {
    throw new Error("Should not be called");
  },
});

const result = await executeProcessNews(makeCtx(box.root), {
  agent, force: true, briefOnly: true,
});
result.success
=> true

agent.invocations.length
=> 0
```

## Agent failure

### Triage agent failure is reported

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed("box/inbox/news/Article.news-item.card", "<news-item>test</news-item>");
box.commitAll("add news");

const agent = createFakeAgent({
  name: "news-triage",
  act: async () => {
    return { success: false, error: "Rate limited" };
  },
});

const result = await executeProcessNews(makeCtx(box.root), {
  agent, force: true, triageOnly: true,
});
// Triage failure is reported
result.data.results[0].phase
=> triage

result.data.results[0].success
=> false

// Only 1 invocation — ensureAgentCommitted does NOT retry a failed agent
agent.invocations.length
=> 1
```
