# User message display: `<unsure>` word marks

`UserMessageText` (`components/chat/user-message-text.tsx`) renders a sent
message's body, expanding the `<send-message>`/`<user-selection>` pills.
Track 4 of `docs/plans/transcript-confidence.md` adds a third embedded tag:
`<unsure>word</unsure>`, placed in the body by `markUnsureWords` (Track 3)
around a word the transcriber had low acoustic confidence in. The raw tag
must never reach the DOM — it renders as its inner word with a subtle dotted
underline, no tooltip, no legend.

`stripUserDisplayTags` (called first, inside `UserMessageText`) only strips
the `<speech>`/`<typed>` *shell* tags and their attributes — including the
`stt="deepgram"` provenance attribute — so this also covers that the
attribute never leaks into the rendered bubble.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UserMessageText } from "../../src/frontend/src/components/chat/user-message-text.js";

globalThis.React = React;

function render(text: string): string {
  return renderToStaticMarkup(React.createElement(UserMessageText, { text }));
}
```

## A marked word renders with the dotted-underline span, tag never shown raw

```ts
const out = render('<speech stt="deepgram" local-time="14:23">they\'re all <unsure>cloud</unsure> code in different ways</speech>');
out.includes("<unsure>")
=> false

out.includes("</unsure>")
=> false

out.includes('stt="deepgram"')
=> false

out.includes("decoration-dotted")
=> true

out.includes(">cloud</span>")
=> true
```

## Marked word in the middle of a sentence — surrounding text is untouched

```ts
const midOut = render('<speech stt="deepgram">In fact, you are an <unsure>agent</unsure> today.</speech>');
midOut.includes("In fact, you are an")
=> true

midOut.includes("today.")
=> true

midOut.includes("<unsure")
=> false
```

## No marks at all — message renders unchanged, no pill machinery kicks in

A message with no `<unsure>`/`<send-message>`/`<user-selection>` tags takes
the plain-text fast path (no wrapping `<span>` per word).

```ts
render('<speech local-time="14:23">found three items</speech>')
=> found three items
```

## Multiple marks in one message — each word wraps independently

```ts
const multiOut = render("<speech stt=\"deepgram\">that one <unsure>not</unsure> that <unsure>one</unsure> thing</speech>");
(multiOut.match(/decoration-dotted/g) ?? []).length
=> 2

multiOut.includes("<unsure")
=> false
```

## A message with no `stt` attribute (no confidence data captured) is unaffected

`stt` is absent whenever Deepgram confidence wasn't captured or applied
(Voxtral, OpenAI realtime, iOS native dictation, HQ-replaced text) — the
body then simply has no `<unsure>` marks to render, and the wrapper's other
attributes still strip cleanly.

```ts
render('<speech diarized="1" local-time="14:23">speaker A and speaker B</speech>')
=> speaker A and speaker B
```
