# The reactor runs on the box's pinned model

A box can pin the model it thinks with (`agentModel` in `_config/box.json`). The
reactor reads it once per run and passes it to every agent invocation in that
run, so "which model does my box think with" has the same answer for autonomous
work as it does for chat.

The seam is deliberately narrow: the reactor asks for the policy, rather than
`createAgent` silently supplying it to every unpinned agent run in the system
(`docs/implemented-plans/model-engine-policy.md`, Track B).

```ts setup
import { processBatchJobs } from "../../src/core/reactor/batch-jobs.js";
import { createFakeAgent } from "../helpers/fake-agent.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { clearBoxConfigCache } from "../../src/core/box/config.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const job = { card: { file: "j.job.card", priority: "normal", createdAt: null }, relPath: "jobs/j.job.card", content: "do a thing" };

/** Run one batch pass against `boxRoot`, returning the model it invoked with. */
async function modelUsedBy(boxRoot: string): Promise<string | undefined> {
  const agent = createFakeAgent({ name: "reactor-batch", act: async () => ({ success: true }) });
  await processBatchJobs({ jobs: [job], boxRoot, dryRun: false, createAgent: () => agent });
  return agent.invocations[0]?.options.model;
}

async function pin(boxRoot: string, config: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.join(boxRoot, "config"), { recursive: true });
  await fs.writeFile(path.join(boxRoot, "_config/box.json"), JSON.stringify(config));
  clearBoxConfigCache(boxRoot);
}
```

An unpinned box keeps today's behavior — no model, so the harness picks.

```ts
const box = await makeTmpBox({ git: true });
await modelUsedBy(box.root)
=> undefined
```

A pinned model reaches the invocation.

```ts continue
await pin(box.root, { agentModel: "claude-sonnet-5" });
await modelUsedBy(box.root)
=> claude-sonnet-5
```

A pin the box's engine cannot run resolves to that engine's model at the same
tier, rather than disappearing: a Codex box pinned to Sonnet runs Terra.

```ts continue
await pin(box.root, { agentEngine: "codex", agentModel: "claude-sonnet-5" });
await modelUsedBy(box.root)
=> gpt-5.6-terra
```

A retired id is carried forward instead of failing the registry check and
reading as "no policy".

```ts continue
await pin(box.root, { agentModel: "claude-opus-4-8" });
await modelUsedBy(box.root)
=> claude-opus-5

await pin(box.root, { agentModel: "not-a-model" });
await modelUsedBy(box.root)
=> undefined

await box.cleanup();
```
