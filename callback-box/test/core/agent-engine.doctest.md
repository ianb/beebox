# Agent engine selection

`createAgent()` selects one native harness from `config/box.json` on its first
invocation. Existing boxes have no setting and continue to use Claude. The
selected delegate remains fixed for the lifetime of that agent.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createAgent } from "../../src/core/agent/index.js";
import { clearBoxConfigCache } from "../../src/core/box/config.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

async function setEngine(boxRoot: string, agentEngine: unknown): Promise<void> {
  const configDir = path.join(boxRoot, "config");
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, "box.json"), JSON.stringify({ agentEngine }));
  clearBoxConfigCache(boxRoot);
}
```

## Existing boxes default to Claude

The dry-run banner identifies the selected harness without starting either
vendor subprocess.

```ts
const box = await makeTmpBox();
const agent = createAgent({ name: "selection-test" });
const result = await agent.invoke({ boxRoot: box.root, prompt: "hello", dryRun: true });

result.output.startsWith("[DRY RUN] Would run Claude")
=> true

await box.cleanup();
```

## A box can select Codex

```ts
const box = await makeTmpBox();
await setEngine(box.root, "codex");
const agent = createAgent({ name: "selection-test" });
const result = await agent.invoke({ boxRoot: box.root, prompt: "hello", dryRun: true });

result.output.startsWith("[DRY RUN] Would run Codex SDK")
=> true

await box.cleanup();
```

## An unknown engine fails before agent invocation

Configuration errors never fall back silently to a different vendor.

```ts
const box = await makeTmpBox();
await setEngine(box.root, "mystery");
const agent = createAgent({ name: "selection-test" });

await agent.invoke({ boxRoot: box.root, prompt: "hello", dryRun: true })
=> throws InvalidAgentEngineError: Box config agentEngine must be either claude or codex

await box.cleanup();
```
