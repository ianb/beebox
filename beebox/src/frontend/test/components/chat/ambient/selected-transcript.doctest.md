# The selected conversation's transcript, shared with ambient replies

Ambient replies record which reply of the selected conversation the user has
seen. They read that conversation from the open chat instead of fetching its
history and status again. Two rules keep the record right: the transcript is
offered only after the chat's first history load (an empty transcript seen
first would become the baseline, and the real reply would then read as new),
and only to the ambient reply for that same session.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SelectedTranscriptRegion, useSelectedTranscript } from "../../../../src/components/chat/ambient/selected-transcript.js";

globalThis.React = React;

function Probe({ sessionId }) {
  const transcript = useSelectedTranscript(sessionId);
  return React.createElement("span", null, transcript === null ? "none" : `${transcript.total}:${transcript.busy}`);
}

function render({ loaded, probeFor }) {
  const entries = [{ type: "user", uuid: "u1", content: [{ type: "text", text: "Hello" }] }];
  return renderToStaticMarkup(React.createElement(SelectedTranscriptRegion,
    { sessionId: "chat-a", loaded, entries, total: 1, busy: false },
    React.createElement(Probe, { sessionId: probeFor })));
}
```

Once the chat has loaded, the ambient reply for the open conversation gets its transcript:

```ts
render({ loaded: true, probeFor: "chat-a" })
=> <span>1:false</span>
```

Before the first history load finishes, it gets nothing, and keeps waiting:

```ts
render({ loaded: false, probeFor: "chat-a" })
=> <span>none</span>
```

Another conversation's ambient reply never sees it, and fetches its own:

```ts
render({ loaded: true, probeFor: "chat-b" })
=> <span>none</span>
```
