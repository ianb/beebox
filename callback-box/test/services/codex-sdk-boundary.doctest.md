# Codex SDK boundary

Only the shared Codex session adapter imports the official SDK. Product callers
consume Callback Box contracts. The raw app-server compatibility client is only
available to transcript administration.

```ts setup
import { globSync } from "glob";
import * as fs from "node:fs";
import * as path from "node:path";

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
