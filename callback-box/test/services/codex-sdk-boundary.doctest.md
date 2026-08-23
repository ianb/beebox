# Codex SDK boundary

Only the shared Codex session adapter imports the official SDK. Product callers
consume Callback Box contracts. The raw app-server compatibility client is only
available to transcript administration.

```ts setup
import { globSync } from "glob";
import * as fs from "node:fs";
import * as path from "node:path";
import { resultFromCodexTurn } from "../../src/core/agent/codex-run-result.js";

function importers(fragment: string): string[] {
  return globSync("src/**/*.ts").filter((file) => fs.readFileSync(file, "utf8").includes(fragment)).sort();
}
```

```ts
JSON.stringify(importers('from "@openai/codex-sdk"'))
=> ["src/services/codex-sdk-session.ts"]

JSON.stringify(importers('codex-history-server.js"'))
=> ["src/core/chat/session/codex-transcript.ts"]

fs.existsSync(path.join("src", "services", "codex-app-server.ts"))
=> false
```

A failed Codex turn with no assistant response is an invocation failure (the
shape used by startup/model rejection), while a failure after assistant output
keeps partial-progress semantics:

```ts
const rejected = resultFromCodexTurn({
  threadId: "rejected",
  output: "",
  resultText: "",
  status: "failed",
  error: "Model is not supported",
});
const partial = resultFromCodexTurn({
  threadId: "partial",
  output: "I changed a file.",
  resultText: "I changed a file.",
  status: "failed",
  error: "Turn failed after partial work",
});
const toolOnly = resultFromCodexTurn({
  threadId: "tool-only",
  output: "",
  resultText: "",
  status: "failed",
  error: "Turn failed after editing a file",
  hadAssistantActivity: true,
});
JSON.stringify({
  rejected: rejected.success ? false : rejected.invocationFailure === true,
  partial: partial.success ? false : partial.invocationFailure === true,
  toolOnly: toolOnly.success ? false : toolOnly.invocationFailure === true,
})
=> {"rejected":true,"partial":false,"toolOnly":false}
```
