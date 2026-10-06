# Per-invocation agent environment

Research allowance IDs reach the real runner setup for both model engines.
Explicit environment additions use an agent-safe environment without server
secrets. Ordinary Codex calls retain their prior environment behavior. Only the
external SDK/CLI boundaries are replaced here.

```ts setup
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { buildScriptEnv } from "../../../../src/core/script-env/core.js";
import * as auth from "../../../../src/core/agent/auth-preflight.js";
```

```ts
const box = await makeTmpBox();
const originalSecret = process.env.BBX_HUB_SECRET;
const originalId = process.env.BBX_TRIAGE_RUN_ID;
process.env.BBX_HUB_SECRET = "synthetic-server-secret";
process.env.BBX_TRIAGE_RUN_ID = "inherited-run";
let claudeEnv: Record<string, string> = {};
const { runAgent } = await t.mockImport("../../../../src/core/agent/invoke/run.ts", {
  "../../../../src/core/agent/auth-preflight.ts": { ...auth, checkClaudeAuth: async () => {} },
  "../../../../src/core/agent/invoke/stream.ts": { consumeAgentStream: async ({ queryOptions }) => {
    claudeEnv = queryOptions.env;
    return { outputBuf: "", resultMessage: null, assignedSessionId: null, errorText: "synthetic stop", hadAssistantActivity: false };
  } },
});
await runAgent({ boxRoot: box.root, prompt: "test", systemPrompt: "", env: { BBX_TRIAGE_RUN_ID: "claude-run", BBX_TRIAGE_RESEARCH: "1" } });
JSON.stringify([claudeEnv.BBX_TRIAGE_RUN_ID, claudeEnv.BBX_TRIAGE_RESEARCH, claudeEnv.BBX_SPAWN_PROFILE, claudeEnv.BBX_HUB_SECRET ?? null, process.env.BBX_TRIAGE_RUN_ID])
=> ["claude-run","1","agent",null,"inherited-run"]

let codexEnv: Record<string, string> = {};
const { runCodexAgent } = await t.mockImport("../../../../src/core/agent/codex-run/core.ts", {
  "../../../../src/core/agent/auth-preflight.ts": { ...auth, checkCodexAuth: async () => {} },
  "../../../../src/core/agent/ensure-codex-plugin.ts": { ensureCodexPluginInstalled: async () => {} },
});
const result = await runCodexAgent({ boxRoot: box.root, prompt: "test", systemPrompt: "", env: { BBX_TRIAGE_RUN_ID: "codex-run", BBX_TRIAGE_RESEARCH: "1" } }, options => {
  codexEnv = options.env;
  return { id: null, run: async () => ({ sessionId: "fake-session", output: "done", resultText: "done", durationMs: 1, status: "completed", error: null, usage: null, items: [] }) };
});
result.success
=> true

JSON.stringify([codexEnv.BBX_TRIAGE_RUN_ID, codexEnv.BBX_TRIAGE_RESEARCH, codexEnv.BBX_SPAWN_PROFILE, codexEnv.BBX_HUB_SECRET ?? null, process.env.BBX_TRIAGE_RUN_ID])
=> ["codex-run","1","agent",null,"inherited-run"]

codexEnv.CODEX_HOME === process.env.CODEX_HOME
=> true

let defaultEnv: unknown = "unset";
await runCodexAgent({ boxRoot: box.root, prompt: "test", systemPrompt: "" }, options => {
  defaultEnv = options.env;
  return { id: null, run: async () => ({ sessionId: "fake-default", output: "done", resultText: "done", durationMs: 1, status: "completed", error: null, usage: null, items: [] }) };
});
defaultEnv === undefined
=> true

const next = await buildScriptEnv(box.root);
JSON.stringify([next.BBX_TRIAGE_RUN_ID, next.BBX_TRIAGE_RESEARCH ?? null, next.BBX_HUB_SECRET ?? null])
=> ["inherited-run",null,null]
```

```ts cleanup
if (originalSecret === undefined) delete process.env.BBX_HUB_SECRET; else process.env.BBX_HUB_SECRET = originalSecret;
if (originalId === undefined) delete process.env.BBX_TRIAGE_RUN_ID; else process.env.BBX_TRIAGE_RUN_ID = originalId;
await box.cleanup();
```
