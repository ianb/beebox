# Codex knowledge-audit behavior

Codex audit evidence comes from the official SDK activity surface. Shell
commands are retained both as Bash activity and as read evidence, allowing the
existing path-oriented checks to work without inventing a Claude-style Read tool.

```ts setup
import { codexBehaviorFromActivity } from "../../../src/dev/lib/codex-audit-behavior.js";
import { emitObservedActivity } from "../../../src/core/agent/codex-run-activity.js";
import type { CodexObservedActivity } from "../../../src/core/agent/codex-run-activity.js";

const behavior = codexBehaviorFromActivity([
  { type: "command", command: "sed -n '1,80p' node_modules/beebox/box-docs/card-image.md" },
  { type: "command", command: "/opt/homebrew/bin/bash -lc \"sed -n '1,80p' node_modules/beebox/box-docs/card-image.md && rg -n EXIF node_modules/beebox/box-docs\"" },
  { type: "command", command: "rg -n EXIF node_modules/beebox/box-docs" },
  { type: "search", tool: "WebSearch", summary: "EXIF DateTimeOriginal" },
], "  The date comes from EXIF.  ");
```

The typed SDK item feeds the audit activity mapper directly:

```ts
const observed: CodexObservedActivity[] = [];
const completed = {
  id: "command-1",
  type: "command_execution" as const,
  command: "/bin/bash -lc 'cat AGENTS.md'",
  aggregated_output: "instructions",
  exit_code: 0,
  status: "completed" as const,
};
emitObservedActivity(completed, (activity) => observed.push(activity));
JSON.stringify(observed)
=> [{"type":"command","command":"/bin/bash -lc 'cat AGENTS.md'"}]
```

```ts
const summary = JSON.stringify({
  readCount: behavior.filesRead.length,
  wrappedReadDetected: behavior.filesRead.some((command) => command.includes("bash -lc")),
  bashCount: behavior.bashRawCommands.length,
  searchCount: behavior.searches.length,
  response: behavior.responseText,
  words: behavior.responseLength,
  context: behavior.context,
});
summary
=> {"readCount":3,"wrappedReadDetected":true,"bashCount":3,"searchCount":3,"response":"The date comes from EXIF.","words":5,"context":null}
```
