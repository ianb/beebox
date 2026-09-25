# The start target carries engine AND model

A cross-engine pick in the model panel is one gesture: `onChooseStart({ engine,
model })`. Both halves have to survive into the conversation target, or the new
chat starts on the chosen engine's *default* model and the boxholder has to
pick again — the two-step switch of
`issues/bugs/2026-08-30-engine-switch-forces-default-model-first.md`.

There are two places that build a start target. The other one
(`everywhere/resolve-conversation.ts`) already carried the model, which is how
this one kept dropping it unnoticed.

```ts setup
import { conversationTargetFor } from "../../../src/frontend/src/components/chat/conversation/use-conversation-machine.js";
```

## A cross-engine pick keeps its model

```ts
JSON.stringify(conversationTargetFor(
  { sessionInput: "new", contextDir: "", startEngine: "claude", startModel: "claude-haiku-4-5-20251001" },
  "fresh-id",
))
=> {"kind":"start","clientConversationId":"fresh-id","contextDir":"","engine":"claude","model":"claude-haiku-4-5-20251001"}
```

## Choosing only an engine leaves the model unset

Absent means "follow the engine's default", which is not the same as pinning
that default — so no `model` key is emitted at all.

```ts
JSON.stringify(conversationTargetFor(
  { sessionInput: "new", contextDir: "", startEngine: "codex" },
  "fresh-id",
))
=> {"kind":"start","clientConversationId":"fresh-id","contextDir":"","engine":"codex"}
```

## An unknown engine falls back to claude, and a resumed session ignores both

```ts
conversationTargetFor({ sessionInput: "new", contextDir: "" }, "fresh-id").engine
=> claude

JSON.stringify(conversationTargetFor(
  { sessionInput: "abc123", contextDir: "notes", startEngine: "codex", startModel: "gpt-6-luna" },
  "fresh-id",
))
=> {"kind":"session","sessionId":"abc123","contextDir":"notes"}
```
