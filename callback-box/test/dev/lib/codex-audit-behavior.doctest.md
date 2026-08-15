# Codex knowledge-audit behavior

Codex audit evidence comes from the supported app-server activity surface. Shell
commands are retained both as Bash activity and as read evidence, allowing the
existing path-oriented checks to work without inventing a Claude-style Read tool.

```ts setup
import { codexBehaviorFromActivity } from "../../../src/dev/lib/codex-audit-behavior.js";
import { emitObservedActivity, itemCompletedSchema } from "../../../src/core/agent/codex-run-activity.js";
import type { CodexObservedActivity } from "../../../src/core/agent/codex-run-activity.js";

const behavior = codexBehaviorFromActivity([
  { type: "command", command: "sed -n '1,80p' docs/generated/card-image.md" },
  { type: "command", command: "rg -n EXIF docs/generated" },
  { type: "search", tool: "WebSearch", summary: "EXIF DateTimeOriginal" },
], "  The date comes from EXIF.  ");
```

The live app-server item boundary validates the provider payload before
normalizing it:

```ts
const observed: CodexObservedActivity[] = [];
const completed = itemCompletedSchema.parse({
  threadId: "thread-1",
  turnId: "turn-1",
  item: {
    type: "commandExecution",
    command: "/bin/bash -lc 'cat AGENTS.md'",
    aggregatedOutput: "instructions",
    exitCode: 0,
  },
});
emitObservedActivity(completed.item, (activity) => observed.push(activity));
JSON.stringify(observed)
=> [{"type":"command","command":"/bin/bash -lc 'cat AGENTS.md'"}]
```

```ts
const summary = JSON.stringify({
  filesRead: behavior.filesRead,
  bash: behavior.bashRawCommands,
  searches: behavior.searches,
  response: behavior.responseText,
  words: behavior.responseLength,
  context: behavior.context,
});
summary
=> {"filesRead":["sed -n '1,80p' docs/generated/card-image.md"],"bash":["sed -n '1,80p' docs/generated/card-image.md","rg -n EXIF docs/generated"],"searches":[{"tool":"WebSearch","summary":"EXIF DateTimeOriginal"},{"tool":"Bash","summary":"rg -n EXIF docs/generated"}],"response":"The date comes from EXIF.","words":5,"context":null}
```
