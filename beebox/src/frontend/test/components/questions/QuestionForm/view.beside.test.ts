// # A question beside the chat: answer it or say "Not now"
//
// Beside the chat a question card offers two choices
// (docs/plans/questions-beside-the-chat.md, Track B): answer it (in the chat
// for a text question, with the card's buttons for select and confirm) or
// "Not now", which closes the tab; the workspace's close dismisses it. On the
// Questions page the form keeps its own text box, its note, and "Dismiss",
// and a row can offer "Answer in chat", including a dismissed one.
//
// These mount the real `QuestionForm` in a DOM with a tRPC link that records
// the calls it receives.

// First, and bare: React DOM must load after the happy-dom window exists.
import { mount, type Mounted } from "../../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { createTRPCClient } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "@backend/trpc/routers.js";
import { trpc } from "../../../../src/lib/trpc/client.js";
import { QuestionForm, type QuestionInfo } from "../../../../src/components/questions/QuestionForm/view.js";
import { BoxSlugProvider } from "../../../../src/lib/box-slug.js";

notifyManager.setScheduler((callback) => { callback(); });

const PATH = "_bookkeeping/questions/Pacific-timezone.question.card";

function question(over: Partial<QuestionInfo>): QuestionInfo {
  return { path: `/box/${PATH}`, relativePath: PATH, name: "Pacific-timezone", type: "question", subdir: undefined,
    state: "pending", prompt: "Should times show in Pacific time?", inputType: "text", ...over };
}

async function render(props: Parameters<typeof QuestionForm>[0]) {
  const calls: string[] = [];
  const client = createTRPCClient<AppRouter>({
    links: [() => ({ op }) => observable((observer) => {
      calls.push(op.path);
      observer.next({ result: { type: "data", data: {} } });
      observer.complete();
      return () => {};
    })],
  });
  // No retry, and no garbage-collection timer (a mutation has one too) to keep the process alive.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  const page = h(BoxSlugProvider, { boxSlug: "test1", children: h(QuestionForm, props) });
  const router = createRouter({ routeTree: createRootRoute({ staticData: { title: null }, component: () => page }),
    history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  const view = await mount(h(trpc.Provider, { client, queryClient,
    children: h(QueryClientProvider, { client: queryClient, children: h(RouterProvider, { router }) }) }));
  return { view, calls };
}

/** What a person can act on: the buttons' labels and whether a text box is offered. */
function controls(view: Mounted) {
  return {
    buttons: [...view.container.querySelectorAll("button")].map((b) => b.textContent),
    textBoxes: view.container.querySelectorAll("textarea").length,
    hint: view.container.textContent.includes("Answer in the chat.") ? "Answer in the chat." : null,
  };
}

async function click(view: Mounted, label: string) {
  const button = [...view.container.querySelectorAll("button")].find((b) => b.textContent === label);
  if (button instanceof HTMLElement) await view.act(() => { button.click(); });
}

// ## A text question beside the chat has no box of its own
//
// The composer is where the answer goes; "Not now" closes the tab and sends
// nothing itself (the workspace's close dismisses).
void test("A text question beside the chat has no box of its own", async (t) => {
  const closed: string[] = [];
  const { view, calls } = await render({ question: question({}), onAnswered: () => {}, beside: { onNotNow: () => { closed.push(PATH); } } });
  t.check(controls(view), { buttons: ["Not now"], textBoxes: 0, hint: "Answer in the chat." });
  await click(view, "Not now");
  t.check({ closed, calls }, { closed: [PATH], calls: [] });
  await view.unmount();
});

// ## A confirm question beside the chat keeps its buttons, without the note
void test("A confirm question beside the chat keeps its buttons, without the note", async (t) => {
  const { view } = await render({ question: question({ inputType: "confirm" }), onAnswered: () => {}, beside: { onNotNow: () => {} } });
  t.check(controls(view), { buttons: ["Yes", "No", "Not now"], textBoxes: 0, hint: null });
  await view.unmount();
});

// ## On the Questions page the form is unchanged
void test("On the Questions page the form is unchanged", async (t) => {
  const { view, calls } = await render({ question: question({}), onAnswered: () => {} });
  t.check(controls(view), { buttons: ["Submit Answer", "Dismiss"], textBoxes: 1, hint: null });
  await click(view, "Dismiss");
  t.check(calls, ["actions.dismiss"]);
  await view.unmount();
});

// ## A dismissed row offers "Answer in chat" and no Dismiss
//
// A dismissed question stays answerable (docs/questions.md, Lifecycle), so the
// way back is the same action as for a pending one.
void test("A dismissed row offers Answer in chat and no Dismiss", async (t) => {
  const opened: string[] = [];
  const { view } = await render({ question: question({ state: "dismissed" }), onAnswered: () => {}, onAnswerInChat: () => { opened.push(PATH); } });
  t.check(controls(view), { buttons: ["Submit Answer", "Answer in chat"], textBoxes: 1, hint: null });
  await click(view, "Answer in chat");
  t.check(opened, [PATH]);
  await view.unmount();
});

// ## With the chat hidden, "Answer in the chat" reveals it
//
// On the desktop the question can fill the screen (focus layout, or two card
// panes); then the hint is a button that brings the chat back beside it.
void test("With the chat hidden, Answer in the chat reveals it", async (t) => {
  const shown: string[] = [];
  const { view } = await render({ question: question({}), onAnswered: () => {}, beside: { onNotNow: () => {}, onShowChat: () => { shown.push("chat"); } } });
  t.check(controls(view), { buttons: ["Answer in the chat", "Not now"], textBoxes: 0, hint: null });
  await click(view, "Answer in the chat");
  t.check(shown, ["chat"]);
  await view.unmount();
});
