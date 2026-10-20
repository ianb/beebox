// # Message list renders while a reply streams
//
// `MessageList` rebuilds its row elements on every streamed token. Settled rows
// must not render again: a long transcript would otherwise re-render every
// message, ack badge, and attachment per token. Rows are memoized on their
// group, its acks, and a row context that holds no per-token value
// (`message-items.tsx`, `RenderItemContext`).
//
// The chat below has a user message carrying an ack, the assistant reply that
// made the ack, and a second user message. A reply to the second message
// streams in.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mount } from "../../../../helpers/dom-harness.js";
import { createElement as h, useState, type ComponentProps } from "react";
import type { SessionEntry } from "../../../../../src/api-chat.js";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { MessageList } from "../../../../../src/components/chat/everywhere/InteractiveChat/messages.js";
import { groupMessages } from "../../../../../src/components/chat/ChatMessages/view.js";
import { createAudioOverlayStore } from "../../../../../src/components/chat/audio-overlay-store.js";
import { BoxSlugProvider } from "../../../../../src/lib/box-slug.js";

const at = "2026-10-16T12:00:00Z";
type ListProps = ComponentProps<typeof MessageList>;
const text = ({ uuid, type, body }: { uuid: string; type: SessionEntry["type"]; body: string }): SessionEntry => ({ uuid, type, timestamp: at, content: [{ type: "text", text: body }] });
const history: SessionEntry[] = [
  text({ uuid: "u1", type: "user", body: "Add milk to the list" }),
  text({ uuid: "a1", type: "assistant", body: "<ack kind=\"edited\" ref=\"_content/list.card\">Added milk</ack>\n\n<speech>Done.</speech>" }),
  text({ uuid: "u2", type: "user", body: "And eggs" }),
];
const noop = () => {};
const noopAsync = async (): Promise<void> => {};
const notPlaying = { isPlaying: false, playingMessageId: null, statusMessageId: null, segmentStates: {}, segmentFailures: {}, playingSegmentIndex: null, remainingCount: 0 };

/** MessageList props while turn `t2` streams `streamText` after `history`. */
function streaming(streamText: string): ListProps {
  return {
    messages: history, groups: groupMessages(history), modelMarkers: [], streamTools: [], debugView: false,
    currentUserEmail: "me@example.com", currentUserName: "Me", speechPlayback: notPlaying,
    handleStopSpeech: noop, handleSkipSpeech: noop, handleReplaySpeech: noop, onZoomView: noop,
    snapshot: { matches: (state: string) => state === "streaming" }, isStreaming: true, streamText,
    totalEntries: history.length, onLoadOlder: noop, loadingOlder: false,
    sendSignal: 1, captureSignal: 0, liveTurnId: "t2", proseEnabled: true, pendingHq: [], onHqSendLive: noop,
    captureBubbles: [], captureVerbs: { retry: noopAsync, discard: noopAsync }, audioOverlayStore: createAudioOverlayStore(),
    openers: [], onSendOpener: () => "accepted" as const,
  };
}

/** Mount the list; `update(fn)` replaces its props as the chat machine's next snapshot would. */
async function mountList(initial: ListProps) {
  let pushProps: ((fn: (props: ListProps) => ListProps) => void) | undefined;
  function List() {
    const [props, setProps] = useState(initial);
    pushProps = setProps;
    return h(MessageList, props);
  }
  const router = createRouter({ routeTree: createRootRoute({ staticData: { title: null }, component: List }), history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  const view = await mount(h(BoxSlugProvider, { boxSlug: "test1", children: h(RouterProvider, { router }) }));
  return { view, update: (fn: (props: ListProps) => ListProps) => view.act(() => pushProps?.(fn)) };
}

/** Each row's entry ids, and "(playing)" where its speaker icon pulses. */
function rows(view: Awaited<ReturnType<typeof mount>>) {
  return [...view.container.querySelectorAll<HTMLElement>("[data-entry-uuids]")].map((row) =>
    row.dataset.entryUuids + (row.querySelector(".animate-pulse") ? " (playing)" : ""));
}

// ## Tokens re-render only the streaming row
//
// The reply's first paragraph is already showing. Four more tokens arrive. Only
// the streaming row (`GroupItemInner`, `AssistantMessage`) renders, once per
// token, with the list around it. No user message, ack badge, or settled
// assistant message renders. Before the fix, each token rendered all four rows,
// and the first user message and its ack badge with them.
void test("The reply's first paragraph is already showing.", async (t) => {
  const { view, update } = await mountList(streaming("Eggs are on the list.\n\n"));
  view.resetRenders();
  for (const token of ["Anything ", "else", "?", "\n\n"]) await update((props) => ({ ...props, streamText: props.streamText + token }));
  const counts = view.renders();
  await view.unmount();
  t.check(counts, {
    AssistantMessage: 4,
    AssistantSpeechText: 4,
    AssistantTextGroup: 4,
    ChatParagraph: 2,
    GroupItemInner: 4,
    List: 4,
    Markdown: 1,
    MarkdownContent: 1,
    MessageErrorBoundary: 4,
    MessageListInner: 4,
    SelectionCapture: 4,
    TranscriptSelection: 4,
  });
});

// ## The speaker highlight follows the newest reply
//
// Auto-played speech carries a `stream-…` id, not a message id, so the row it
// highlights is the newest assistant group. Each row learns whether it is that
// group from its own prop, not from the shared row context. Until the reply
// shows, the earlier reply is the newest. When the reply's first paragraph
// shows, the highlight moves to it, and when the turn finalizes into history
// entry `a2`, the same row keeps it.
void test("Auto-played speech carries a stream-… id, not a message id, so the row it hig...", async (t) => {
  const playing = { ...notPlaying, isPlaying: true, playingMessageId: "stream-t2", playingSegmentIndex: 0, remainingCount: 1 };
  const { view, update } = await mountList({ ...streaming(""), speechPlayback: playing });
  const beforeReply = rows(view);
  await update((props) => ({ ...props, streamText: "<speech>Eggs added.</speech>\n\n" }));
  const whileStreaming = rows(view);
  const done = [...history, text({ uuid: "a2", type: "assistant", body: "<speech>Eggs added.</speech>" })];
  await update((props) => ({ ...props, messages: done, groups: groupMessages(done), totalEntries: done.length, isStreaming: false, streamText: "", snapshot: { matches: (state) => state === "idle" } }));
  const finalized = rows(view);
  await view.unmount();
  t.check({ beforeReply, whileStreaming, finalized }, {
    beforeReply: ["u1", "a1 (playing)", "u2"],
    whileStreaming: ["u1", "a1", "u2", "live-t2 (playing)"],
    finalized: ["u1", "a1", "u2", "a2 (playing)"],
  });
});

// ## Finalizing keeps the reply's row mounted
//
// The streamed and finalized forms of a reply share one React key, so
// finalizing updates the row in place instead of remounting it (a remount
// flashes the reply and loses its scroll anchor). A voice message still waiting
// for its transcript sits below the reply in the list; it must not stop the key
// from passing to the finalized reply. The streaming row's DOM node is tagged,
// and after the turn finalizes into `a2` the row still carries the tag:
void test("The streamed and finalized forms of a reply share one React key, so finalizin...", async (t) => {
  const pendingHq = [{ id: "v1", text: "one more thing", status: "Transcribing…" }];
  const { view, update } = await mountList({ ...streaming("Eggs added.\n\n"), pendingHq });
  const rowFor = (uuid: string): HTMLElement => {
    const row = view.container.querySelector<HTMLElement>(`[data-entry-uuids='${uuid}']`);
    if (row === null) throw new Error(`no row for ${uuid}`);
    return row;
  };
  rowFor("live-t2").dataset.probe = "streamed row";
  const done = [...history, text({ uuid: "a2", type: "assistant", body: "Eggs added." })];
  await update((props) => ({ ...props, messages: done, groups: groupMessages(done), totalEntries: done.length, isStreaming: false, streamText: "", snapshot: { matches: (state) => state === "idle" } }));
  const row = rowFor("a2").dataset.probe;
  await view.unmount();
  t.check(row, "streamed row");
});
