/**
 * Scenario scripts for the dev scroll harness (/dev/chat-scroll).
 *
 * A scenario is a list of timed steps plus the outcome it expects, so a run is
 * an assertion rather than a thing to eyeball. Steps model the real forces on
 * the chat scroller — a send, stream growth, finalize shrink, older-history
 * prepend, below-list chrome resizing, a late-decoding image above the
 * viewport, a momentum fling that fires scroll events and no input events at
 * all — and the expectations encode the scroll model
 * (docs/plans/chat-scroll-model.md): the controller writes `scrollTop` only on
 * a discrete user action plus geometric compensations, and content growth
 * below the reader never scrolls.
 *
 * Runner + measurement live in chat-scroll-runner.ts; this file is data.
 */

import type { Scenario } from "./chat-scroll-steps";
import { OPEN_THREAD_SCENARIOS } from "./chat-scroll-scenarios-open";

export type { Step, Expectation, Scenario } from "./chat-scroll-steps";

const STREAM_CHUNK_PX = 26;

const SCENARIOS_MAIN: Scenario[] = [
  {
    name: "follow-while-streaming",
    description: "At the bottom, an ordinary streamed reply. Under the write-on-user-action model the view must NOT follow: fromBottom grows, the badge lights, and the controller writes nothing.",
    steps: [
      { k: "append", px: 40, role: "user" },
      { k: "append", px: 48, role: "assistant" },
      { k: "stream", chunks: 24, intervalMs: 60, chunkPx: STREAM_CHUNK_PX },
      { k: "wait", ms: 200 },
    ],
    expect: {
      finalAtBottom: false,
      finalFromBottomAtLeast: 400,
      driftWhileAwayAtMost: 8,
      finalHasUnseenContent: true,
      writesAtMost: 0,
    },
  },
  {
    name: "fast-growth-hands-off",
    description: "Start at the bottom, stream fast, touch nothing. Nothing follows and nothing is written — the growth simply accumulates below the fold.",
    steps: [
      { k: "append", px: 40, role: "user" },
      { k: "append", px: 48, role: "assistant" },
      { k: "stream", chunks: 60, intervalMs: 16, chunkPx: 44 },
      { k: "wait", ms: 300 },
    ],
    expect: {
      finalAtBottom: false,
      finalFromBottomAtLeast: 1500,
      driftWhileAwayAtMost: 8,
      finalHasUnseenContent: true,
      writesAtMost: 0,
    },
  },
  {
    name: "send-anchors-user-message-top",
    description: "Rule 2: on send the new user message goes to the top of the viewport and stays there while the reply streams in below it.",
    steps: [
      { k: "send", px: 40 },
      { k: "append", px: 48, role: "assistant" },
      { k: "stream", chunks: 10, intervalMs: 40, chunkPx: STREAM_CHUNK_PX },
      { k: "wait", ms: 200 },
    ],
    expect: {
      finalUserMessageTopAtMost: 4,
      finalAtBottom: true,
      writesAtMost: 1,
    },
  },
  {
    name: "reply-longer-than-screen-does-not-follow",
    description: "The reply outgrows the screen. It continues below the fold, the button lights, and the user message stays anchored at the top.",
    steps: [
      { k: "send", px: 40 },
      { k: "append", px: 48, role: "assistant" },
      { k: "stream", chunks: 40, intervalMs: 25, chunkPx: 30 },
      { k: "wait", ms: 250 },
    ],
    expect: {
      finalUserMessageTopAtMost: 4,
      finalAtBottom: false,
      finalFromBottomAtLeast: 400,
      driftWhileAwayAtMost: 8,
      finalHasUnseenContent: true,
      writesAtMost: 1,
    },
  },
  {
    name: "button-returns-to-bottom",
    description: "Rule 3: the floating button smooth-scrolls to the bottom, clears the badge, and the return animation is not fought.",
    steps: [
      { k: "send", px: 40 },
      { k: "append", px: 48, role: "assistant" },
      { k: "stream", chunks: 20, intervalMs: 30, chunkPx: STREAM_CHUNK_PX },
      { k: "button", behavior: "smooth" },
      { k: "wait", ms: 900 },
    ],
    expect: {
      finalAtBottom: true,
      finalFromBottomAtMost: 4,
      finalHasUnseenContent: false,
    },
  },
  {
    name: "scroll-up-mid-stream",
    description: "The user wheels up while a reply streams. The reading position must not be dragged around, and the badge must light for the content landing below.",
    steps: [
      { k: "append", px: 40, role: "user" },
      { k: "append", px: 48, role: "assistant" },
      { k: "stream", chunks: 8, intervalMs: 60, chunkPx: STREAM_CHUNK_PX },
      { k: "userWheel", deltaY: -420 },
      { k: "wait", ms: 120 },
      { k: "stream", chunks: 16, intervalMs: 60, chunkPx: STREAM_CHUNK_PX },
      { k: "wait", ms: 200 },
    ],
    expect: {
      finalAtBottom: false,
      driftWhileAwayAtMost: 8,
      finalHasUnseenContent: true,
    },
  },
  {
    name: "momentum-fling-no-touchmove",
    description: "An iOS fling: scroll events with no input events at all, with an above-viewport reflow landing mid-fling. The reader must never be yanked back.",
    steps: [
      { k: "append", px: 40, role: "user" },
      { k: "append", px: 48, role: "assistant" },
      { k: "stream", chunks: 10, intervalMs: 40, chunkPx: STREAM_CHUNK_PX },
      { k: "fling", steps: 20, stepPx: 60, intervalMs: 30 },
      { k: "imageDecode", msgIndex: 2, px: 220 },
      { k: "fling", steps: 20, stepPx: 60, intervalMs: 30 },
      { k: "wait", ms: 250 },
    ],
    expect: {
      finalAtBottom: false,
      flingReversalsAtMost: 0,
    },
  },
  {
    name: "prepend-older",
    description: "Scrolled up (thumb drag, no input event), older history is prepended. The view must not move and must not claim new content.",
    steps: [
      { k: "userDrag", toTop: 120 },
      { k: "wait", ms: 200 },
      { k: "prepend", count: 12 },
      { k: "wait", ms: 250 },
    ],
    expect: {
      finalAtBottom: false,
      driftWhileAwayAtMost: 8,
      finalHasUnseenContent: false,
    },
  },
  {
    name: "prepend-image-decode-no-badge",
    description: "An image inside a prepended older block finishes decoding, above the viewport. The old controller lit the badge here; growth above the anchor is not new content.",
    steps: [
      { k: "userDrag", toTop: 120 },
      { k: "wait", ms: 200 },
      { k: "prepend", count: 12 },
      { k: "wait", ms: 250 },
      { k: "imageDecode", msgIndex: 2, px: 320 },
      { k: "wait", ms: 300 },
    ],
    expect: {
      finalAtBottom: false,
      driftWhileAwayAtMost: 8,
      finalHasUnseenContent: false,
    },
  },
  {
    name: "real-images-around-reading-marker",
    description: "Real lazy img elements above and below the reading marker receive deterministic data-SVG sources. This measures browser load/decode reflow while reading; data URLs do not demonstrate network lazy-load deferral.",
    steps: [
      { k: "mountImage", msgIndex: 2, heightPx: 280 },
      { k: "mountImage", msgIndex: 20, heightPx: 340 },
      { k: "userDrag", toTop: 900 },
      { k: "wait", ms: 400 },
      { k: "completeImage", msgIndex: 2, expectedPlacement: "above", expectedHeightPx: 280 },
      { k: "wait", ms: 150 },
      { k: "completeImage", msgIndex: 20, expectedPlacement: "below", expectedHeightPx: 340 },
      { k: "wait", ms: 250 },
    ],
    expect: {
      finalAtBottom: false,
      driftWhileAwayAtMost: 8,
      finalHasUnseenContent: true,
    },
  },
  {
    name: "send-then-composer-grows",
    description: "A short reply has unused spacer below it. Resizing the composer after send must retain the sent message at the top, not jump to the natural content bottom.",
    steps: [
      { k: "send", px: 40 },
      { k: "append", px: 48, role: "assistant" },
      { k: "wait", ms: 500 },
      { k: "chromeResize", px: 260 },
      { k: "wait", ms: 200 },
      { k: "chromeResize", px: 96 },
      { k: "wait", ms: 200 },
    ],
    expect: { finalUserMessageTopAtMost: 4, driftWhileAwayAtMost: 8, writesAtMost: 1 },
  },
  {
    name: "chrome-grows",
    description: "Below-list chrome (attachment row / mobile composer) grows and shrinks while at the bottom. Content height never changes; clientHeight does.",
    steps: [
      { k: "wait", ms: 150 },
      { k: "chromeResize", px: 260 },
      { k: "wait", ms: 250 },
      { k: "chromeResize", px: 96 },
      { k: "wait", ms: 250 },
    ],
    expect: {
      finalAtBottom: true,
      finalFromBottomAtMost: 4,
      maxFromBottomWhileAtBottomAtMost: 8,
      leftBottomWithoutIntent: false,
    },
  },
  {
    name: "keyboard-clamp-holds-bottom",
    description: "Rule 4: the mobile keyboard shrinks the scroller while the reader is at the bottom. The previous fromBottom is preserved, so the bottom stays the bottom.",
    steps: [
      { k: "wait", ms: 150 },
      { k: "keyboardClamp", px: 220, holdMs: 400 },
      { k: "wait", ms: 300 },
    ],
    expect: {
      finalAtBottom: true,
      finalFromBottomAtMost: 4,
      maxFromBottomWhileAtBottomAtMost: 8,
      leftBottomWithoutIntent: false,
    },
  },
  {
    name: "pane-close-preserves-reading-anchor",
    description: "A reader partway through a narrow transcript hides the adjacent card pane. The transcript widens and rewraps, but the visible reading point must stay on screen.",
    steps: [
      { k: "wrapWidth", px: 460 },
      { k: "userDrag", toTop: 900, observeReadingPosition: true },
      { k: "resizeWidth", px: 900 },
      { k: "wait", ms: 300 },
    ],
    expect: {
      finalAtBottom: false,
      driftWhileAwayAtMost: 8,
    },
  },
  {
    name: "finalize-shrinks",
    description: "A streamed reply is replaced by a shorter finalized one. The reader is below the fold and reading; the shrink must not move their page.",
    steps: [
      { k: "append", px: 40, role: "user" },
      { k: "append", px: 48, role: "assistant" },
      { k: "stream", chunks: 18, intervalMs: 50, chunkPx: STREAM_CHUNK_PX },
      { k: "finalize", shrinkBy: 240 },
      { k: "wait", ms: 300 },
    ],
    expect: {
      finalAtBottom: false,
      driftWhileAwayAtMost: 8,
    },
  },
  {
    name: "finalize-drops-spacer",
    description: "A short reply to a send. While it streams the last turn keeps a viewport-tall spacer so the user message can sit at the top; once it is complete the spacer goes, and the view clamps to the real bottom with no blank room below the reply.",
    steps: [
      { k: "append", px: 300, role: "assistant" },
      { k: "send", px: 40 },
      { k: "stream", chunks: 3, intervalMs: 50, chunkPx: 40 },
      { k: "finalize", shrinkBy: 20 },
      { k: "wait", ms: 300 },
    ],
    expect: {
      finalAtBottom: true,
      finalFromBottomAtMost: 4,
      finalHasUnseenContent: false,
    },
  },
];

export const SCENARIOS: Scenario[] = [...SCENARIOS_MAIN, ...OPEN_THREAD_SCENARIOS];

export function findScenario(name: string): Scenario | null {
  return SCENARIOS.find((s) => s.name === name) ?? null;
}
