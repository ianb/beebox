# Empty-chat openers

A fresh box's chat opens on suggestions instead of a bare "start a
conversation" line: `ChatOpeners` renders the `openers:` the bound directory's
briefing lists (`chat.openers`), and clicking one sends it as the person's
message.

The frontend doctests run under plain Node with no DOM, so what a click does
lives in `clickOpener` — a plain function the button's `onClick` calls — and is
tested directly. The contracts that matter: the sent text is the opener
verbatim, and one click is all there is (the buttons disable on send, so an
impatient double-click can't queue two turns).

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatOpeners, clickOpener } from "../../src/frontend/src/components/chat/ChatOpeners.js";

globalThis.React = React;

function markup(openers: string[]): string {
  return renderToStaticMarkup(
    React.createElement(ChatOpeners, { openers, onSendOpener: () => {} }),
  );
}

/** A standalone stand-in for the component's `sent` state. */
function clicker(onSendOpener: (text: string) => void) {
  let sent = false;
  return (text: string) => clickOpener({ alreadySent: sent, markSent: () => { sent = true; }, onSendOpener }, text);
}
```

## Each opener renders as its own button, labelled with the opener text

```ts
const out = markup(["Let me tell you what this box is for.", "What can you do?"]);
out.includes("Let me tell you what this box is for.")
=> true

out.includes("What can you do?")
=> true

out.split("<button").length - 1
=> 2
```

## An established box — no openers — renders nothing at all

The agent removes the openers once the box is in regular use, and the chat
falls back to its plain empty-state line. This is the normal end state.

```ts
markup([]) === ""
=> true
```

## Clicking an opener sends that opener's text, verbatim

```ts
const sent: string[] = [];
const click = clicker((t) => sent.push(t));
click("Show me what changed today.")
=> true

JSON.stringify(sent)
=> ["Show me what changed today."]
```

## A second click sends nothing

Two turns from one impatient double-click was the failure mode; the first send
latches the whole set off, so the second click is a no-op rather than a second
message.

```ts
const sent: string[] = [];
const click = clicker((t) => sent.push(t));
click("What can you do?")
=> true

click("What can you do?")
=> false

click("Let me tell you what this box is for.")
=> false

JSON.stringify(sent)
=> ["What can you do?"]
```

## Buttons render enabled until one is clicked

(The `disabled` *attribute* — the class list carries Tailwind's `disabled:`
variants either way, so matching the bare word would always pass.)

```ts
markup(["What can you do?"]).includes('disabled=""')
=> false
```
