# Codex box-agent sandbox policy

A box agent must be able to commit because Git is the box's state history.
Codex force-mounts `.git` read-only under workspace-write even when the package
root is explicitly writable, so both fresh/resumed threads and their turns use
the provider's full-access policy.

```ts setup
import {
  codexBoxThreadSettings,
  codexBoxTurnSettings,
} from "../../src/services/codex-sandbox.js";
import {
  codexRunThreadParams,
  codexRunTurnParams,
} from "../../src/core/agent/codex-run.js";
import {
  codexChatThreadParams,
  codexChatTurnParams,
} from "../../src/services/codex-chat.js";
```

```ts
JSON.stringify(codexBoxThreadSettings())
=> {"approvalPolicy":"never","sandbox":"danger-full-access"}

JSON.stringify(codexBoxTurnSettings())
=> {"approvalPolicy":"never","sandboxPolicy":{"type":"dangerFullAccess"}}
```

The batch adapter's complete fresh, resumed, and turn parameter objects retain
the policy after all provider parameters are composed.

```ts
const batch = {
  boxRoot: "/box/content",
  systemPrompt: "system",
  prompt: "do work",
  model: "test-model",
};

JSON.stringify(codexRunThreadParams(batch))
=> {"cwd":"/box/content","approvalPolicy":"never","sandbox":"danger-full-access","developerInstructions":"system","model":"test-model","ephemeral":false,"sessionStartSource":"startup"}

JSON.stringify(codexRunThreadParams({ ...batch, resumeSessionId: "thread-1" }))
=> {"cwd":"/box/content","approvalPolicy":"never","sandbox":"danger-full-access","developerInstructions":"system","threadId":"thread-1"}

JSON.stringify(codexRunTurnParams(batch, "thread-1"))
=> {"threadId":"thread-1","input":[{"type":"text","text":"do work","text_elements":[]}],"cwd":"/box/content","approvalPolicy":"never","sandboxPolicy":{"type":"dangerFullAccess"},"model":"test-model"}
```

The interactive adapter uses the same full policy for fresh/resumed threads and
turns.

```ts
const chat = {
  cwd: "/box/content",
  systemPrompt: "system",
  model: "test-model",
};

JSON.stringify(codexChatThreadParams(chat))
=> {"cwd":"/box/content","approvalPolicy":"never","sandbox":"danger-full-access","developerInstructions":"system","model":"test-model","ephemeral":false,"sessionStartSource":"startup"}

JSON.stringify(codexChatThreadParams({ ...chat, resumeSessionId: "thread-2" }))
=> {"cwd":"/box/content","approvalPolicy":"never","sandbox":"danger-full-access","developerInstructions":"system","model":"test-model","threadId":"thread-2"}

JSON.stringify(codexChatTurnParams({ opts: chat, threadId: "thread-2", content: [{ type: "text", text: "hello" }] }))
=> {"threadId":"thread-2","input":[{"type":"text","text":"hello","text_elements":[]}],"cwd":"/box/content","approvalPolicy":"never","sandboxPolicy":{"type":"dangerFullAccess"},"model":"test-model"}
```
