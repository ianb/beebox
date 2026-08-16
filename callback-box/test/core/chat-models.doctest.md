# Engine-aware chat models

The model picker and mutation boundary share one engine-indexed registry.

```ts setup
import { chatModelOptions, isChatModelAllowed, parseChatAgentEngine } from "../../src/shared/chat-models.js";
import { chatModelFileForSession, loadCurrentModel, loadCurrentModelForEngine, saveCurrentModel } from "../../src/core/chat/session/state.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

```ts
JSON.stringify(chatModelOptions("claude").map((option) => option.label))
=> ["Default (Opus)","Haiku 4.5","Sonnet 5","Opus 5","Fable 5"]

JSON.stringify(chatModelOptions("codex"))
=> [{"label":"Default (Codex)","model":null},{"label":"Sol","model":"gpt-5.6-sol"},{"label":"Terra","model":"gpt-5.6-terra"},{"label":"Luna","model":"gpt-5.6-luna"}]

isChatModelAllowed("codex", "gpt-5.6-sol")
=> true

isChatModelAllowed("codex", "claude-opus-5")
=> false

JSON.stringify([parseChatAgentEngine("codex"), parseChatAgentEngine(undefined), parseChatAgentEngine("other")])
=> ["codex",null,null]
```

Web chats persist overrides independently by native session id.

```ts
const box = await makeTmpBox();
const firstFile = chatModelFileForSession("first");
const secondFile = chatModelFileForSession("second");
saveCurrentModel(box.root, { modelFile: firstFile, model: "gpt-5.6-sol" });

JSON.stringify([loadCurrentModel(box.root, firstFile), loadCurrentModel(box.root, secondFile)])
=> ["gpt-5.6-sol",null]

saveCurrentModel(box.root, { modelFile: secondFile, model: "claude-opus-5" });
JSON.stringify([
  loadCurrentModelForEngine(box.root, { modelFile: firstFile, engine: "codex" }),
  loadCurrentModelForEngine(box.root, { modelFile: secondFile, engine: "codex" }),
])
=> ["gpt-5.6-sol",null]

await box.cleanup();
```
