# Ambient reply identity and attention

A completion event is a refresh signal, not answer content. Only a complete
persisted assistant group supplies a stable preview. Bounded tails must not
interpret an arbitrary suffix as a whole callout.

```ts setup
import { projectAmbientReply, observeAmbientReply, EMPTY_ATTENTION } from "../../../src/frontend/src/components/chat/ambient/projection.js";
import type { SessionEntry } from "../../../src/cli/lib/session-entry.js";
function entry(uuid: string, type: "user" | "assistant", text: string): SessionEntry {
  return { uuid, type, timestamp: "2026-09-07T00:00:00Z", content: [{ type: "text", text }] };
}
const question = entry("u1", "user", "Compare these");
const answer = entry("a1", "assistant", '<callout context="Comparison">See [report](view:report.doc.card)</callout>');
```

```ts
const full = projectAmbientReply("kitchen", { entries: [question, answer], total: 2, running: false });
JSON.stringify([full.identity, full.complete, full.callouts.length])
=> ["kitchen:a1",true,1]

projectAmbientReply("kitchen", { entries: [question, answer], total: 2, running: true }).complete
=> false

const suffix = projectAmbientReply("kitchen", { entries: [answer], total: 20, running: false });
JSON.stringify([suffix.complete, suffix.identity, suffix.callouts.length, suffix.earlier])
=> [true,null,0,true]

projectAmbientReply("kitchen", { entries: [question, entry("", "assistant", "Legacy answer")], total: 2, running: false }).identity
=> null

projectAmbientReply("kitchen", { entries: [question], total: 1, running: false }).complete
=> false
```

Old history establishes a baseline. A new reply needs attention; another new
reply never acknowledges its predecessor. Explicit dismissal only acknowledges
the current identity, and another session cannot share that identity.

```ts
const baseline = observeAmbientReply(EMPTY_ATTENTION, "kitchen:a1");
baseline.attention
=> false

const changed = observeAmbientReply(baseline, "kitchen:a2");
changed.attention
=> true

observeAmbientReply(changed, null).attention
=> true

const dismissed = { ...changed, attention: false, dismissedReply: changed.lastReply };
observeAmbientReply(dismissed, "kitchen:a2").attention
=> false

observeAmbientReply(dismissed, "kitchen:a3").attention
=> true

projectAmbientReply("garden", { entries: [question, answer], total: 2, running: false }).identity
=> garden:a1
```

Replayed completion events never revive dismissed notices, including empty
outcomes without assistant UUIDs.

```ts
const { recordAmbientCompletion } = await import("../../../src/frontend/src/components/chat/ambient/projection.js");
const completed = recordAmbientCompletion(EMPTY_ATTENTION, "completion-one");
const acknowledged = { ...completed, attention: false };
recordAmbientCompletion(acknowledged, "completion-one").attention
=> false

recordAmbientCompletion(acknowledged, "completion-two").attention
=> true
```

A route may show the retained previous transcript while a new landmark resolves.
That transition must not acknowledge the previous conversation's reply.

```ts
const { canAcknowledgeAmbientReply } = await import("../../../src/frontend/src/components/chat/ambient/projection.js");
JSON.stringify(["resolving", "unavailable", "ready"].map(kind => canAcknowledgeAmbientReply(true, kind)))
=> [false,false,true]

canAcknowledgeAmbientReply(false, "ready")
=> false
```
