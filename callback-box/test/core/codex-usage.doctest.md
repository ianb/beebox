# Codex usage ledger

Codex app-server reports per-turn token counts, but its supported transcript API
does not retain them. Callback Box appends the final `last` count for each turn
to its own ledger, and the ordinary usage sync imports both native engines.

```ts setup
import { appendCodexTurnUsage, readCodexTurnUsage } from "../../src/core/codex-usage.js";
import { queryUsage, syncUsage } from "../../src/core/usage.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

```ts
const box = await makeTmpBox();
const usage = {
  inputTokens: 100,
  cachedInputTokens: 60,
  cacheWriteInputTokens: 4,
  outputTokens: 12,
  reasoningOutputTokens: 7,
};
await appendCodexTurnUsage(box.root, {
  sessionId: "codex-session",
  turnId: "turn-1",
  task: "web-chat",
  timestamp: "2026-08-13T12:00:00.000Z",
  model: "gpt-test",
  usage,
});
await appendCodexTurnUsage(box.root, {
  sessionId: "codex-session",
  turnId: "turn-2",
  task: "web-chat",
  timestamp: "2026-08-13T12:05:00.000Z",
  model: "gpt-test",
  usage,
});

(await readCodexTurnUsage(box.root)).length
=> 2

await syncUsage(box.root);
JSON.stringify(queryUsage(box.root, "SELECT task, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, message_count FROM usage"))
=> [{"task":"web-chat","input_tokens":200,"output_tokens":24,"cache_write_tokens":8,"cache_read_tokens":120,"message_count":2}]

await box.cleanup();
```
