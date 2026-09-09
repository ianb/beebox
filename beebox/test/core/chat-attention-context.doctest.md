# Captured content attention

The optional view context describes presentation, independently of destination.
An explicit snapshot replaces legacy companion context, including clearing it.

```ts setup
import { sendBodySchema, extractCardFields, buildSendInput } from "../../src/webapp/routes/chat-helpers.js";
import { composeChatAppSnapshot, parseChatAppDeltas } from "../../src/core/chat/features.js";
import { combineQueuedInputs } from "../../src/core/chat/session/state.js";
```

```ts
const body = sendBodySchema.parse({ message: "this", session: "kitchen", contextDir: "_content/kitchen", openCard: "_content/stale.doc.card", viewContext: { surface: "card", focusedRef: "_content/house/Report.doc.card?view=chart#cost", transcript: "hidden" } });
const fields = extractCardFields(body);
fields.openCard
=> _content/house/Report.doc.card

body.contextDir
=> _content/kitchen

composeChatAppSnapshot(fields)
=> <chat-app open-card="_content/house/Report.doc.card" surface="card" transcript="hidden"/>

JSON.stringify(extractCardFields({ openCard: "_content/stale.doc.card", cardActivity: ["modified"], cardState: { modified: "stale details" }, viewContext: { surface: "dashboard", transcript: "hidden" } }))
=> {"viewContext":{"surface":"dashboard","transcript":"hidden"}}

composeChatAppSnapshot(extractCardFields({ openCard: "_content/Old.doc.card" }))
=> <chat-app open-card="_content/Old.doc.card"/>

parseChatAppDeltas('<chat-app surface="card" transcript="visible"/>').deltas.length
=> 0
```

Invalid URLs and hidden form data cannot become implicit context at the HTTP
boundary. The schema strips unknown keys and rejects non-box references.

```ts
sendBodySchema.safeParse({ message: "hi", session: "new", viewContext: { surface: "card", focusedRef: "https://example.com/?token=secret", transcript: "hidden" } }).success
=> false

sendBodySchema.safeParse({ message: "hi", session: "new", viewContext: { surface: "card", focusedRef: "../../secret", transcript: "hidden" } }).success
=> false

sendBodySchema.safeParse({ message: "hi", session: "new", viewContext: { surface: "other", focusedRef: "_config/settings.card", transcript: "hidden" } }).success
=> false

JSON.stringify(sendBodySchema.parse({ message: "hi", session: "new", viewContext: { surface: "other", transcript: "hidden", formValue: "secret" } }).viewContext)
=> {"surface":"other","transcript":"hidden"}
```

A queued turn retains the last snapshot. Activity from a different subject does
not get relabeled as activity on the current card. Text and explicit selections
remain in the original messages.

```ts
const first = buildSendInput({ text: "first", images: undefined, channel: undefined, cardFields: extractCardFields({ viewContext: { surface: "card", focusedRef: "_content/A.doc.card", transcript: "visible" }, cardActivity: ["modified"], cardState: { modified: "changed A" } }) });
const second = buildSendInput({ text: "second", images: undefined, channel: undefined, cardFields: extractCardFields({ viewContext: { surface: "card", focusedRef: "_content/B.doc.card", transcript: "hidden" }, cardActivity: ["scrolled"], cardState: { scrolled: "0.6" } }) });
const combined = combineQueuedInputs([first, second]);
JSON.stringify(combined.cardActivity)
=> ["scrolled"]

JSON.stringify(combined.cardState)
=> {"scrolled":"0.6"}

JSON.stringify(combined.viewContext)
=> {"surface":"card","focusedRef":"_content/B.doc.card","transcript":"hidden"}

combineQueuedInputs([first, { text: "dashboard", viewContext: { surface: "dashboard", transcript: "hidden" } }]).openCard
=> undefined
```
