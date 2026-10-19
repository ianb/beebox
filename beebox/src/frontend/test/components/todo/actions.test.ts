// # Todo actions — tick and "+ to chat"
//
// A rendered todo gets its two actions from `TodoActionsContext`
// (`components/todo/todo-actions.ts`, `docs/plans/todos-ui.md` Track 3).
// `FileView` provides it around a card; Markdown rendered anywhere else has no
// provider, and then the checkbox is read-only and there is no "+".
//
// The tests run under plain Node with no DOM, so a click is exercised
// through the same functions the checkbox calls (`tickInput`, `runTick`,
// `todoSelection`), and the rendered controls through static markup.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import assert from "node:assert/strict";
import { TodoItem } from "../../../src/components/todo/TodoItem.js";
import {
  runTick,
  tickInput,
  todoSelection,
  TodoActionsContext,
  type SetTodoStatusInput,
  type TodoActions,
  type TodoAddress,
} from "../../../src/components/todo/actions.js";

globalThis.React = React;

const address: TodoAddress = { path: "_content/Porch.doc.card", locator: { kind: "body", line: 12 }, text: "Order lumber" };

type ItemProps = Omit<React.ComponentProps<typeof TodoItem>, "children">;

function render(props: Pick<ItemProps, "status"> & Partial<ItemProps>, actions: TodoActions | undefined) {
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
    children: "Order lumber",
  });
  return renderToStaticMarkup(actions === undefined ? item : React.createElement(TodoActionsContext.Provider, { value: actions }, item));
}

/** Whether the checkbox is live, and whether a "+" is offered. */
function controls(html: string) {
  const box = /<input[^>]*>/.exec(html)?.[0] ?? "";
  return `${box.includes("disabled") ? "read-only" : "live"}, ${html.includes('aria-label="Add to chat"') ? "+" : "no +"}`;
}

const calls: SetTodoStatusInput[] = [];
const chatCalls: TodoAddress[] = [];
const actions: TodoActions = {
  setStatus: async (input) => { calls.push(input); },
  addToChat: (todo) => { chatCalls.push(todo); },
};

// ## Where the controls appear
//
// With no provider, the checkbox is read-only and there is no "+":
void test("With no provider, the checkbox is read-only and there is no \"+\":", async (t) => {
  t.check(controls(render({ status: "open" }, undefined)), "read-only, no +");
});

// With a provider, an open or done todo's checkbox is live and "+" is offered.
// A parked or dropped todo keeps a disabled checkbox (it cannot express that
// status) but can still go to chat. An agent's open todo is tickable too.
void test("With a provider, an open or done todo's checkbox is live and \"+\" is offered.", async (t) => {
  t.check(
    [
      controls(render({ status: "open" }, actions)),
      controls(render({ status: "done" }, actions)),
      controls(render({ status: "parked" }, actions)),
      controls(render({ status: "dropped" }, actions)),
      controls(render({ status: "open", assigned: "agent" }, actions)),
    ].join(" | "),
    "live, + | live, + | read-only, + | read-only, + | live, +",
  );
});

// A surface with no chat composer provides `addToChat: null`: ticking, no "+".
// A todo without a full address (no card path or no text, as in chat Markdown)
// and a list's muted context row get neither.
void test("A surface with no chat composer provides addToChat:", async (t) => {
  t.check(
    [
      controls(render({ status: "open" }, { ...actions, addToChat: null })),
      controls(render({ status: "open", cardPath: null }, actions)),
      controls(render({ status: "open", text: null }, actions)),
      controls(render({ status: "open", muted: true }, actions)),
    ].join(" | "),
    "live, no + | read-only, no + | read-only, no + | read-only, no +",
  );
});

// ## What a click sends
//
// Ticking an open todo asks for `done` and says it saw `open`; unticking is the
// reverse. The server refuses the write unless both the text and the status
// still match (`test/webapp/trpc/routers/todos.set-status.test.ts`).
void test("Ticking an open todo asks for done and says it saw open; unticking is the rev...", async (t) => {
  t.check(tickInput(address, "open"), {
    path: "_content/Porch.doc.card",
    locator: {
      kind: "body",
      line: 12,
    },
    text: "Order lumber",
    expectedStatus: "open",
    status: "done",
  });

  t.check([tickInput(address, "done")?.status, tickInput(address, "done")?.expectedStatus, tickInput(address, "parked"), tickInput(address, "dropped")], [
    "open",
    "done",
    null,
    null,
  ]);
});

// ## Optimistic, and reverted with the reason
//
// `runTick` shows the new state before the write returns. On success it leaves
// it (the refreshed card replaces it); on failure it puts the old state back
// and shows why.
void test("runTick shows the new state before the write returns.", async (t) => {
  function recorder() {
    const log: string[] = [];
    return { log, view: { show: (s: "open" | "done" | null) => log.push(`show ${String(s)}`), fail: (m: string | null) => log.push(`fail ${String(m)}`) } };
  }

  calls.length = 0;
  const ok = recorder();
  const okInput = tickInput(address, "open");
  assert.ok(okInput);
  await runTick(actions, { input: okInput, view: ok.view });
  t.check([ok.log, calls.map((c) => `${c.expectedStatus}->${c.status}`)], [
    [
      "fail null",
      "show done",
    ],
    [
      "open->done",
    ],
  ]);

  const failing = { ...actions, setStatus: async () => { throw new Error("This card changed since it was shown — it has been reloaded"); } };
  const bad = recorder();
  const originalWarn = console.warn;
  console.warn = () => {};
  const badInput = tickInput(address, "open");
  assert.ok(badInput);
  await runTick(failing, { input: badInput, view: bad.view });
  console.warn = originalWarn;
  t.check(bad.log, [
    "fail null",
    "show done",
    "show null",
    "fail This card changed since it was shown — it has been reloaded",
  ]);
});

// ## "+" is a chat selection
//
// The selection names the card by its absolute ref, carries the todo's words,
// and says where the todo sits.
void test("The selection names the card by its absolute ref, carries the todo's words, a...", async (t) => {
  t.check(
    [
      todoSelection(address),
      todoSelection({ ...address, locator: { kind: "body", line: 12, nth: 2 } }).position,
      todoSelection({ ...address, path: "/_content/Porch.doc.card", locator: { kind: "frontmatter", index: 0 } }),
    ],
    [
    {
      ref: "/_content/Porch.doc.card",
      text: "Order lumber",
      position: "todo at line 12",
    },
    "todo at line 12 (#2 on that line)",
    {
      ref: "/_content/Porch.doc.card",
      text: "Order lumber",
      position: "todo in frontmatter",
    },
  ],
  );
});
