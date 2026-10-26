// # The empty root chat asks the box's open question
//
// An unstarted root chat with a pending question shows it as the agent's
// opening line, with the card's memo under it, "and N more" to the Questions
// page, and a quiet "Not now"; the openers and "Start a conversation." follow
// (docs/implemented-plans/front-door.md, Track A). Clicking the line is an invitation to
// answer, so it focuses the composer. A chat with no question shows the openers
// alone, as before. This mounts `MessageList` in its empty state.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mount } from "../../../../helpers/dom-harness.js";
import { createElement as h, type ComponentProps } from "react";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { MessageList } from "../../../../../src/components/chat/everywhere/InteractiveChat/messages.js";
import type { OpenQuestion } from "../../../../../src/components/chat/open-question.js";
import { createAudioOverlayStore } from "../../../../../src/components/chat/audio-overlay-store.js";
import { BoxSlugProvider } from "../../../../../src/lib/box-slug.js";

type ListProps = ComponentProps<typeof MessageList>;
const noop = () => {};
const noopAsync = async (): Promise<void> => {};
const notPlaying = { isPlaying: false, playingMessageId: null, statusMessageId: null, segmentStates: {}, segmentFailures: {}, playingSegmentIndex: null, remainingCount: 0 };

/** An empty, idle chat with `openers`, asking `openQuestion`; the callbacks record what the person did in `log`. */
function emptyChat({ openQuestion, log, openers }: { openQuestion: OpenQuestion | null; log: string[]; openers?: string[] }): ListProps {
  return {
    messages: [], groups: [], modelMarkers: [], streamTools: [], debugView: false,
    currentUserEmail: "me@example.com", currentUserName: "Me", speechPlayback: notPlaying,
    handleStopSpeech: noop, handleSkipSpeech: noop, handleReplaySpeech: noop, onZoomView: noop,
    snapshot: { matches: (state: string) => state === "idle" }, isStreaming: false, streamText: "",
    totalEntries: 0, onLoadOlder: noop, loadingOlder: false,
    sendSignal: 0, captureSignal: 0, liveTurnId: null, proseEnabled: true, pendingHq: [], onHqSendLive: noop,
    captureBubbles: [], captureVerbs: { retry: noopAsync, discard: noopAsync }, audioOverlayStore: createAudioOverlayStore(),
    openers: openers ?? [], onSendOpener: () => "accepted" as const,
    openQuestion,
    onFocusComposer: () => log.push("focus"),
    onQuestionNotNow: (path) => log.push(`not now ${path}`),
    onOpenQuestions: () => log.push("open questions"),
  };
}

async function mountEmpty(props: ListProps) {
  const router = createRouter({ routeTree: createRootRoute({ staticData: { title: null }, component: () => h(MessageList, props) }), history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  return mount(h(BoxSlugProvider, { boxSlug: "test1", children: h(RouterProvider, { router }) }));
}

/** What the empty state shows, top to bottom: the question block's lines, then the opener buttons, then the empty label. */
function shown(container: HTMLElement) {
  const question = container.querySelector<HTMLElement>("[data-testid=chat-open-question]");
  return {
    question: question === null ? null : [...question.querySelectorAll<HTMLElement>("button, p, [data-testid=chat-open-question-memo]")].filter((el) => el.parentElement?.closest("[data-testid=chat-open-question-memo]") === null).map((el) => el.textContent?.trim() ?? ""),
    openers: [...container.querySelectorAll<HTMLElement>("[data-testid=chat-openers] button")].map((el) => el.textContent),
    label: container.querySelector(".bbx-chat-empty-label")?.textContent,
  };
}

const ROOT_QUESTION: OpenQuestion = {
  path: "_bookkeeping/questions/what-to-keep-track-of.question.card",
  prompt: "What do you want to keep track of here?",
  memo: "I'd like to know what this box is for before I suggest anything.",
  inputType: "text",
  options: [],
  optionsBeyond: 0,
  more: 0,
};

// A new box: the one question, its memo, "Not now" (no "and N more": it is the
// only one), the voice opener, then the usual line. Clicking the question
// focuses the composer; "Not now" dismisses that card.
void test("A new box's empty root chat asks its one question", async (t) => {
  const log: string[] = [];
  const view = await mountEmpty(emptyChat({ openQuestion: ROOT_QUESTION, log, openers: ["Tell me about talking instead of typing."] }));
  t.teardown(() => view.unmount());
  t.check(shown(view.container), {
    question: [
      "What do you want to keep track of here?",
      "I'd like to know what this box is for before I suggest anything.",
      "Not now",
      "Not now",
    ],
    openers: ["Tell me about talking instead of typing."],
    label: "Start a conversation.",
  });
  await view.act(() => { view.container.querySelector<HTMLElement>("[data-question-path]")?.click(); });
  await view.act(() => { [...view.container.querySelectorAll<HTMLElement>("[data-testid=chat-open-question] button")].find((b) => b.textContent === "Not now")?.click(); });
  t.check(log, ["focus", "not now _bookkeeping/questions/what-to-keep-track-of.question.card"]);
});

// A box with a backlog: a select question lists its options in the line, no
// memo line when the card has none, and "and N more" opens the Questions page.
void test("A select question lists its options; 'and N more' opens the Questions page", async (t) => {
  const log: string[] = [];
  const view = await mountEmpty(emptyChat({ openQuestion: { path: "_bookkeeping/questions/Receipt.question.card", prompt: "Where do receipts go?", memo: null, inputType: "select", options: ["Finance", "Personal"], optionsBeyond: 0, more: 38 }, log }));
  t.teardown(() => view.unmount());
  t.check(shown(view.container), {
    question: ["Where do receipts go? Finance or Personal?", "and 38 more · Not now", "and 38 more", "Not now"],
    openers: [],
    label: "Start a conversation.",
  });
  await view.act(() => { [...view.container.querySelectorAll<HTMLElement>("[data-testid=chat-open-question] button")].find((b) => b.textContent === "and 38 more")?.click(); });
  t.check(log, ["open questions"]);
});

// A place chat, a started chat, and a box with nothing pending pass null: the
// empty state is the openers and the line, as before.
void test("With no open question the empty state is the openers alone", async (t) => {
  const view = await mountEmpty(emptyChat({ openQuestion: null, log: [], openers: ["Log a new loan"] }));
  t.teardown(() => view.unmount());
  t.check(shown(view.container), { question: null, openers: ["Log a new loan"], label: "Start a conversation." });
});

// The agent writes the memo with card markup, quoting what the person said.
// The quote shows as a quote, never as the raw `{% quote %}` tags.
void test("A memo's quote markup renders, not its tags", async (t) => {
  const memo = "You said {% quote %}keep it simple{% /quote %} last week.";
  const view = await mountEmpty(emptyChat({ openQuestion: { ...ROOT_QUESTION, memo }, log: [] }));
  t.teardown(() => view.unmount());
  const shownMemo = view.container.querySelector<HTMLElement>("[data-testid=chat-open-question-memo]");
  t.check(shownMemo?.textContent?.replaceAll(/\s+/gu, " ").trim(), "You said “keep it simple” last week.");
});
