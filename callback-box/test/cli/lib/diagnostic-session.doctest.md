# Diagnostic session provider resolution

`cb session` and `cb feedback` use native session identities without guessing from
opaque ID syntax. Explicit selection wins, the current Codex thread is recognized,
and registered web chats retain their pinned engine.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  parseDiagnosticEngine,
  resolveDiagnosticEngine,
  validateCodexSessionMode,
} from "../../../src/cli/lib/diagnostic-session.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
```

```ts
parseDiagnosticEngine("codex")
=> codex

parseDiagnosticEngine("other")
=> throws InvalidDiagnosticEngineError: Unknown session engine "other". Expected claude or codex.

validateCodexSessionMode({ raw: true, toolReport: false, full: false })
=> throws UnsupportedCodexSessionModeError: Codex sessions support readable dialogue only; --raw, --tool-report, and --full require native rollout detail that app-server does not expose.

validateCodexSessionMode({ raw: false, toolReport: false, full: false })
=> undefined
```

## Resolution precedence

```ts
const box = await makeTmpBox();
await fs.mkdir(path.join(box.root, ".callback-box"), { recursive: true });
await fs.writeFile(
  path.join(box.root, ".callback-box", "chat-session-history.json"),
  JSON.stringify({
    migrated: true,
    sessions: [
      { id: "pinned-codex", engine: "codex" },
      { id: "pinned-claude", engine: "claude" },
    ],
  }),
);

await resolveDiagnosticEngine({
  boxRoot: box.root,
  sessionId: "pinned-codex",
  requestedEngine: undefined,
  codexThreadId: undefined,
})
=> codex

await resolveDiagnosticEngine({
  boxRoot: box.root,
  sessionId: "current-native",
  requestedEngine: undefined,
  codexThreadId: "current-native",
})
=> codex

await resolveDiagnosticEngine({
  boxRoot: box.root,
  sessionId: "unknown-id",
  requestedEngine: undefined,
  codexThreadId: undefined,
})
=> claude

await resolveDiagnosticEngine({
  boxRoot: box.root,
  sessionId: "pinned-codex",
  requestedEngine: "claude",
  codexThreadId: "pinned-codex",
})
=> claude
```

```ts cleanup
await box.cleanup();
```
