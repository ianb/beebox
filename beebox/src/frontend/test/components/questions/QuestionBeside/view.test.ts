// # A question beside the chat: answer in the chat, Later, or Decide for me
//
// Beside the chat the question is pasted onto a stub card with no answer
// controls: the person answers in the chat, in words, so a select question
// lists its choices in a line. The row offers Later and Decide for me; a
// question the box decided says so, as the box's, and stays the person's to
// answer (docs/implemented-plans/questions-later-and-figure-it-out.md, Track A).
//
// These mount the real `QuestionBeside` in a DOM.

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
import type { QuestionInfo } from "../../../../src/components/questions/QuestionForm/view.js";
import { QuestionBeside, type BesideActions } from "../../../../src/components/questions/QuestionBeside/view.js";
import { BoxSlugProvider } from "../../../../src/lib/box-slug.js";

notifyManager.setScheduler((callback) => { callback(); });

const PATH = "_bookkeeping/questions/Pacific-timezone.question.card";

function question(over: Partial<QuestionInfo>): QuestionInfo {
  return { path: `/box/${PATH}`, relativePath: PATH, name: "Pacific-timezone", type: "question", subdir: undefined,
    state: "pending", prompt: "Should times show in Pacific time?", inputType: "text", ...over };
}

async function render(props: Parameters<typeof QuestionBeside>[0]) {
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
  const page = h(BoxSlugProvider, { boxSlug: "test1", children: h(QuestionBeside, props) });
  const router = createRouter({ routeTree: createRootRoute({ staticData: { title: null }, component: () => page }),
    history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  const view = await mount(h(trpc.Provider, { client, queryClient,
    children: h(QueryClientProvider, { client: queryClient, children: h(RouterProvider, { router }) }) }));
  return { view, calls };
}

function actions(over: Partial<BesideActions>, log: string[]): BesideActions {
  return { onLater: () => { log.push("later"); }, onFigureOut: () => { log.push("figure"); }, figuring: false, onShowChat: undefined, chatSide: "right", ...over };
}

/** What a person sees to act on: the buttons, the lines of text, and the notch's side. */
function seen(view: Mounted) {
  const patch = view.container.querySelector("[data-question-beside]");
  return {
    buttons: [...view.container.querySelectorAll("button")].map((b) => b.textContent),
    textBoxes: view.container.querySelectorAll("textarea, input").length,
    choices: view.container.querySelector(".bbx-question-choices")?.textContent ?? null,
    decided: view.container.querySelector('[data-testid="question-box-decided"]')?.textContent ?? null,
    hint: view.container.querySelector(".bbx-question-row p")?.textContent ?? null,
    side: patch?.getAttribute("data-chat-side") ?? null,
  };
}

async function click(view: Mounted, label: string) {
  const button = [...view.container.querySelectorAll("button")].find((b) => b.textContent === label);
  if (button instanceof HTMLElement) await view.act(() => { button.click(); });
}

// ## A pending question: no answer controls, Later and Decide for me
//
// A select question lists its choices; the buttons call the row's actions.
void test("A pending question: no answer controls, Later and Decide for me", async (t) => {
  const log: string[] = [];
  const { view, calls } = await render({ question: question({ inputType: "select", options: ["Finance", "Personal", "Taxes"] }), actions: actions({}, log) });
  t.check(seen(view), { buttons: ["Later", "Decide for me"], textBoxes: 0, choices: "Finance, Personal, or Taxes?", decided: null, hint: "Answer in the chat.", side: "right" });
  await click(view, "Later");
  await click(view, "Decide for me");
  t.check({ log, calls }, { log: ["later", "figure"], calls: [] });
  await view.unmount();
});

// ## A put-away question offers only answering in the chat
//
// It is already put away, and Decide for me starts from a pending question
// (`actions.figureOut` puts it away first).
void test("A put-away question offers only answering in the chat", async (t) => {
  const { view } = await render({ question: question({ state: "dismissed" }), actions: actions({ chatSide: "below" }, []) });
  t.check(seen(view), { buttons: [], textBoxes: 0, choices: null, decided: null, hint: "Answer in the chat.", side: "below" });
  await view.unmount();
});

// ## A question the box decided says so, as the box's
//
// The decision and its reasoning show; nothing offers to decide it again; the
// person can still answer it in the chat.
void test("A question the box decided says so, as the box's", async (t) => {
  const provisional = { decision: "Filed in Inbox/Receipts for now", reasoning: "The triage rules name it as the fallback.", undo: "Move it to the folder you name", "decided-at": "2026-10-26T06:00:00Z" };
  const { view } = await render({ question: question({ state: "dismissed", provisional }), actions: actions({}, []) });
  t.check(seen(view), { buttons: [], textBoxes: 0, choices: null,
    decided: "The box decided for now: Filed in Inbox/Receipts for nowThe triage rules name it as the fallback.",
    hint: "Answer it yourself in the chat.", side: "right" });
  await view.unmount();
});

// ## With the chat hidden, "Answer in the chat" reveals it
void test("With the chat hidden, Answer in the chat reveals it", async (t) => {
  const log: string[] = [];
  const { view } = await render({ question: question({}), actions: actions({ onShowChat: () => { log.push("chat"); } }, log) });
  await click(view, "Answer in the chat");
  t.check({ buttons: seen(view).buttons, log }, { buttons: ["Answer in the chat", "Later", "Decide for me"], log: ["chat"] });
  await view.unmount();
});
