# A chat's model: its own, or the box's

A chat holds a model *choice*, not a model. An explicit pick is persisted and
used. No pick means the chat **follows** the box default — and follows it
onward, so pinning a new default changes what every unopinionated chat starts
on.

Which model a running chat uses is settled once, when its subprocess starts.
That is what lets a pin leave conversations in progress alone.

```ts setup
import { resolveSessionModel } from "../../src/core/chat/session/model.js";
import { clearBoxConfigCache } from "../../src/core/box/config.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const run = promisify(execFile);

async function pin(boxRoot: string, config: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.join(boxRoot, "config"), { recursive: true });
  await fs.writeFile(path.join(boxRoot, "config/box.json"), JSON.stringify(config));
  clearBoxConfigCache(boxRoot);
}

const FOLLOW = { explicit: null, engine: "claude" as const };
```

A chat with no choice of its own follows the box; one with a choice keeps it.

```ts
const box = await makeTmpBox();
JSON.stringify(await resolveSessionModel(box.root, FOLLOW))
=> {"model":null,"source":"none"}

await pin(box.root, { agentModel: "claude-sonnet-5" });
JSON.stringify(await resolveSessionModel(box.root, FOLLOW))
=> {"model":"claude-sonnet-5","source":"default"}

JSON.stringify(await resolveSessionModel(box.root, { engine: "claude", explicit: "claude-fable-5-1" }))
=> {"model":"claude-fable-5-1","source":"explicit"}
```

Changing the pin changes what a follower resolves next time — the reason a
follower must not be frozen onto its first resolution.

```ts continue
await pin(box.root, { agentModel: "claude-haiku-4-5-20251001" });
JSON.stringify(await resolveSessionModel(box.root, FOLLOW))
=> {"model":"claude-haiku-4-5-20251001","source":"default"}

await box.cleanup();
```

## Migrating the legacy box-wide pointer

`.beebox/chat-model.json` was the model a chat with no id yet inherited —
the path every chat on a Codex box took. The migration carries its value into
the box policy so those chats keep starting on the same model, then removes the
file.

```ts
const legacyBox = await makeTmpBox();
const legacyPath = path.join(legacyBox.root, ".beebox/chat-model.json");
const script = path.resolve("scripts/migrate/chat-model-to-box-config.ts");
const migrate = async () => run("pnpm", ["exec", "tsx", script, legacyBox.root, "--apply"]);

await fs.mkdir(path.dirname(legacyPath), { recursive: true });
await fs.writeFile(legacyPath, JSON.stringify({ model: "claude-opus-4-8" }));
await migrate();
clearBoxConfigCache(legacyBox.root);

// A retired id is carried forward, not copied verbatim.
JSON.stringify(await resolveSessionModel(legacyBox.root, FOLLOW))
=> {"model":"claude-opus-5","source":"default"}

await fs.access(legacyPath).then(() => "present", () => "gone")
=> gone
```

Running it again is a no-op, and a box that already pinned a model is never
overwritten by a staler pointer.

```ts continue
await migrate();
clearBoxConfigCache(legacyBox.root);
JSON.stringify(await resolveSessionModel(legacyBox.root, FOLLOW))
=> {"model":"claude-opus-5","source":"default"}

await fs.writeFile(legacyPath, JSON.stringify({ model: "claude-haiku-4-5-20251001" }));
await migrate();
clearBoxConfigCache(legacyBox.root);
JSON.stringify(await resolveSessionModel(legacyBox.root, FOLLOW))
=> {"model":"claude-opus-5","source":"default"}

await legacyBox.cleanup();
```
