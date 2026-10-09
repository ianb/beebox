# A chat's model: its own, or the box's

A chat holds a model *choice*, not a model. An explicit pick is persisted and
used. No pick means the chat **follows** the box default — and follows it
onward, so pinning a new default changes what every unopinionated chat starts
on.

Which model a running chat uses is settled once, when its subprocess starts.
That is what lets a pin leave conversations in progress alone.

```ts setup
import { resolveSessionModel } from "../../../../src/core/chat/session/model.js";
import { clearBoxConfigCache } from "../../../../src/core/box/config.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

async function pin(boxRoot: string, config: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.join(boxRoot, "_config"), { recursive: true });
  await fs.writeFile(path.join(boxRoot, "_config/box.json"), JSON.stringify(config));
  clearBoxConfigCache(boxRoot);
}

const FOLLOW = { explicit: null, engine: "claude" as const };
```

A chat with no choice of its own follows the box; one with a choice keeps it.

```ts
const box = await makeTmpBox();
const unpinned = await resolveSessionModel(box.root, FOLLOW);
JSON.stringify([unpinned.model.length > 0, unpinned.source])
=> [true,"default"]

const pinned = "claude-sonnet-5";
await pin(box.root, { agentModel: pinned });
const followed = await resolveSessionModel(box.root, FOLLOW);
JSON.stringify([followed.model === pinned, followed.source])
=> [true,"default"]

const choice = "claude-fable-5-1";
const own = await resolveSessionModel(box.root, { engine: "claude", explicit: choice });
JSON.stringify([own.model === choice, own.source])
=> [true,"explicit"]

await box.cleanup();
```
