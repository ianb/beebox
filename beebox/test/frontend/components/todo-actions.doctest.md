# Todo actions — tick and "+ to chat"

A rendered todo gets its two actions from `TodoActionsContext`
(`components/todo/todo-actions.ts`, `docs/plans/todos-ui.md` Track 3).
`FileView` provides it around a card; Markdown rendered anywhere else has no
provider, and then the checkbox is read-only and there is no "+".

The doctests run under plain Node with no DOM, so a click is exercised
through the same functions the checkbox calls (`tickInput`, `runTick`,
`todoSelection`), and the rendered controls through static markup.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TodoItem } from "../../../src/frontend/src/components/todo/TodoItem.js";
import {
  runTick,
  tickInput,
  todoSelection,
  TodoActionsContext,
} from "../../../src/frontend/src/components/todo/todo-actions.js";

globalThis.React = React;

const address = { path: "_content/Porch.memo.card", locator: { kind: "body", line: 12 }, text: "Order lumber" };

function render(props, actions) {
  const item = React.createElement(TodoItem, {
    assigned: undefined,
    due: undefined,
    start: undefined,
    plateState: null,
    layout: "inline",
    locator: address.locator,
    cardPath: address.path,
    text: address.text,
    muted: false,
    ...props,
  }, "Order lumber");
  return renderToStaticMarkup(actions === undefined ? item : React.createElement(TodoActionsContext.Provider, { value: actions }, item));
}

/** Whether the checkbox is live, and whether a "+" is offered. */
function controls(html) {
  const box = /<input[^>]*>/.exec(html)?.[0] ?? "";
  return `${box.includes("disabled") ? "read-only" : "live"}, ${html.includes('aria-label="Add to chat"') ? "+" : "no +"}`;
}

const calls = [];
const actions = {
  setStatus: async (input) => { calls.push(input); },
  addToChat: (todo) => { calls.push(todo); },
};
```

## Where the controls appear

With no provider, the checkbox is read-only and there is no "+":

```ts
controls(render({ status: "open" }, undefined))
=> read-only, no +
```

With a provider, an open or done todo's checkbox is live and "+" is offered.
A parked or dropped todo keeps a disabled checkbox (it cannot express that
status) but can still go to chat. An agent's open todo is tickable too.

```ts
[
  controls(render({ status: "open" }, actions)),
  controls(render({ status: "done" }, actions)),
  controls(render({ status: "parked" }, actions)),
  controls(render({ status: "dropped" }, actions)),
  controls(render({ status: "open", assigned: "agent" }, actions)),
].join(" | ")
=> live, + | live, + | read-only, + | read-only, + | live, +
```

A surface with no chat composer provides `addToChat: null`: ticking, no "+".
A todo without a full address (no card path or no text, as in chat Markdown)
and a list's muted context row get neither.

```ts
[
  controls(render({ status: "open" }, { ...actions, addToChat: null })),
  controls(render({ status: "open", cardPath: null }, actions)),
  controls(render({ status: "open", text: null }, actions)),
  controls(render({ status: "open", muted: true }, actions)),
].join(" | ")
=> live, no + | read-only, no + | read-only, no + | read-only, no +
```

## What a click sends

Ticking an open todo asks for `done` and says it saw `open`; unticking is the
reverse. The server refuses the write unless both the text and the status
still match (`trpc-todos-set-status.doctest.md`).

```ts
JSON.stringify(tickInput(address, "open"))
=> {"path":"_content/Porch.memo.card","locator":{"kind":"body","line":12},"text":"Order lumber","expectedStatus":"open","status":"done"}

JSON.stringify([tickInput(address, "done")?.status, tickInput(address, "done")?.expectedStatus, tickInput(address, "parked"), tickInput(address, "dropped")])
=> ["open","done",null,null]
```

## Optimistic, and reverted with the reason

`runTick` shows the new state before the write returns. On success it leaves
it (the refreshed card replaces it); on failure it puts the old state back
and shows why.

```ts
function recorder() {
  const log = [];
  return { log, view: { show: (s) => log.push(`show ${String(s)}`), fail: (m) => log.push(`fail ${String(m)}`) } };
}

calls.length = 0;
const ok = recorder();
await runTick(actions, { input: tickInput(address, "open"), view: ok.view });
JSON.stringify([ok.log, calls.map((c) => `${c.expectedStatus}->${c.status}`)])
=> [["fail null","show done"],["open->done"]]
```

```ts continue
const failing = { ...actions, setStatus: async () => { throw new Error("This card changed since it was shown — it has been reloaded"); } };
const bad = recorder();
const originalWarn = console.warn;
console.warn = () => {};
await runTick(failing, { input: tickInput(address, "open"), view: bad.view });
console.warn = originalWarn;
JSON.stringify(bad.log)
=> ["fail null","show done","show null","fail This card changed since it was shown — it has been reloaded"]
```

## "+" is a chat selection

The selection names the card by its absolute ref, carries the todo's words,
and says where the todo sits.

```ts
JSON.stringify([
  todoSelection(address),
  todoSelection({ ...address, locator: { kind: "body", line: 12, nth: 2 } }).position,
  todoSelection({ ...address, path: "/_content/Porch.memo.card", locator: { kind: "frontmatter", index: 0 } }),
])
=> [{"ref":"/_content/Porch.memo.card","text":"Order lumber","position":"todo at line 12"},"todo at line 12 (#2 on that line)",{"ref":"/_content/Porch.memo.card","text":"Order lumber","position":"todo in frontmatter"}]
```
