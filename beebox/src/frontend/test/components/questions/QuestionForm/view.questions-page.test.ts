// # The Questions page form: Later, and "Answer in chat"
//
// On the Questions page a question keeps its form: its own text box, a
// confirm's note, and "Later", which puts it away (the dismiss transition;
// docs/implemented-plans/questions-later-and-figure-it-out.md). A row can offer "Answer in
// chat", including a dismissed one, to bring it beside the chat.
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
  };
}

async function click(view: Mounted, label: string) {
  const button = [...view.container.querySelectorAll("button")].find((b) => b.textContent === label);
  if (button instanceof HTMLElement) await view.act(() => { button.click(); });
}

// ## A pending question offers Later, which puts it away
void test("A pending question offers Later, which puts it away", async (t) => {
  const { view, calls } = await render({ question: question({}), onAnswered: () => {} });
  t.check(controls(view), { buttons: ["Submit Answer", "Later"], textBoxes: 1 });
  await click(view, "Later");
  t.check(calls, ["actions.dismiss"]);
  await view.unmount();
});

// ## A dismissed row offers "Answer in chat" and no Later
//
// A dismissed question stays answerable (docs/questions.md, Lifecycle), so the
// way back is "Answer in chat"; it is already put away.
void test("A dismissed row offers Answer in chat and no Later", async (t) => {
  const opened: string[] = [];
  const { view } = await render({ question: question({ state: "dismissed" }), onAnswered: () => {}, onAnswerInChat: () => { opened.push(PATH); } });
  t.check(controls(view), { buttons: ["Submit Answer", "Answer in chat"], textBoxes: 1 });
  await click(view, "Answer in chat");
  t.check(opened, [PATH]);
  await view.unmount();
});
