/**
 * Rule 1 of the scroll model: opening a thread lands at the bottom and holds
 * it through the first render — images fetched late, images cached but not
 * yet laid out, the hold's own write racing its scroll event, a session
 * switch while the previous thread's images are still loading. Composed into
 * SCENARIOS by chat-scroll-scenarios.ts.
 */

import type { Scenario } from "./chat-scroll-steps";

export const OPEN_THREAD_SCENARIOS: Scenario[] = [
  {
    name: "open-thread-lands-at-bottom",
    description: "Rule 1: a thread opens empty and its history lands in several async chunks. Every chunk keeps the bottom until the first render has settled.",
    steps: [
      { k: "openThread" },
      { k: "wait", ms: 80 },
      { k: "append", px: 420, role: "assistant" },
      { k: "wait", ms: 80 },
      { k: "append", px: 60, role: "user" },
      { k: "append", px: 380, role: "assistant" },
      { k: "wait", ms: 120 },
      { k: "append", px: 300, role: "assistant" },
      { k: "wait", ms: 120 },
      { k: "settleOpen" },
      { k: "wait", ms: 200 },
    ],
    expect: {
      finalAtBottom: true,
      finalFromBottomAtMost: 4,
      finalHasUnseenContent: false,
    },
  },
  {
    name: "open-thread-late-image-at-bottom",
    description: "Rule 1 with images: the history lands and settles, then an image in the last message finishes fetching well after the settle window. The untouched reader is still at the bottom.",
    steps: [
      { k: "openThread" },
      { k: "append", px: 420, role: "assistant" },
      { k: "append", px: 60, role: "user" },
      { k: "append", px: 120, role: "assistant" },
      { k: "settleOpen", awaitImage: true },
      { k: "wait", ms: 600 },
      { k: "imageDecode", msgIndex: 2, px: 500 },
      { k: "wait", ms: 200 },
    ],
    expect: {
      finalAtBottom: true,
      finalFromBottomAtMost: 4,
      finalHasUnseenContent: false,
    },
  },
  {
    name: "open-thread-growth-before-scroll-event",
    description: "Open a thread whose history lands in two growths within one resize pass. The hold's own write is followed by growth before its scroll event arrives; that event reads off-bottom but the reader did nothing, so the hold must survive it.",
    steps: [
      { k: "openThread" },
      { k: "append", px: 420, role: "assistant" },
      { k: "growTwiceInOnePass", px: 300, againPx: 92 },
      { k: "wait", ms: 100 },
      { k: "append", px: 200, role: "assistant" },
      { k: "settleOpen" },
      { k: "wait", ms: 200 },
    ],
    expect: {
      finalAtBottom: true,
      finalFromBottomAtMost: 4,
      finalHasUnseenContent: false,
    },
  },
  {
    name: "open-thread-cached-images-grow-after-settle",
    description: "Cached images are complete before they are decoded and laid out: nothing is pending at settle, yet the transcript keeps growing a frame at a time for half a second. Growth restarts the quiet period; the reader stays at the bottom.",
    steps: [
      { k: "openThread" },
      { k: "append", px: 420, role: "assistant" },
      { k: "append", px: 120, role: "assistant" },
      { k: "settleOpen" },
      { k: "wait", ms: 300 },
      { k: "growPerFrame", frames: 40, px: 404 },
      { k: "wait", ms: 200 },
    ],
    expect: {
      finalAtBottom: true,
      finalFromBottomAtMost: 4,
      finalHasUnseenContent: false,
    },
  },
  {
    name: "reopen-before-images-land",
    description: "A session switch while the previous thread's images are still loading. The stale thread's image lands after the new one opened; it must not end the new thread's hold, whose own image lands later.",
    steps: [
      { k: "openThread" },
      { k: "append", px: 300, role: "assistant" },
      { k: "settleOpen", awaitImage: true },
      { k: "openThread" },
      { k: "append", px: 420, role: "assistant" },
      { k: "append", px: 120, role: "assistant" },
      { k: "settleOpen", awaitImage: true },
      { k: "imageDecode", msgIndex: 0, px: 40 },
      { k: "wait", ms: 600 },
      { k: "imageDecode", msgIndex: 1, px: 500 },
      { k: "wait", ms: 200 },
    ],
    expect: {
      finalAtBottom: true,
      finalFromBottomAtMost: 4,
      finalHasUnseenContent: false,
    },
  },
];
