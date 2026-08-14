# Engine-aware chat models

The model picker and mutation boundary share one engine-indexed registry.

```ts setup
import { chatModelOptions, isChatModelAllowed, parseChatAgentEngine } from "../../src/shared/chat-models.js";
import { chatModelFileForSession, loadCurrentModel, saveCurrentModel } from "../../src/core/chat/session/state.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

```ts
JSON.stringify(chatModelOptions("claude").map((option) => option.label))
=> ["Default (Opus)","Haiku 4.5","Sonnet 5","Opus 5","Fable 5"]

JSON.stringify(chatModelOptions("codex"))
=> [{"label":"Default (Codex)","model":null},{"label":"GPT-5.6 Sol","model":"gpt-5.6-sol"},{"label":"GPT-5.6 Terra","model":"gpt-5.6-terra"}]

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

await box.cleanup();
```
