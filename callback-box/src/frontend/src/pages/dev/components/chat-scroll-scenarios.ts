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

export type Step =
  /** A new message of `px` height lands at the bottom. */
  | { k: "append"; px: number; role: "user" | "assistant" }
  /** The user sends: a user message lands, takes the last-turn spacer, and the
   *  controller anchors it to the top of the viewport. */
  | { k: "send"; px: number }
  /** Grow the last message `chunks` times by `chunkPx`, every `intervalMs`. */
  | { k: "stream"; chunks: number; intervalMs: number; chunkPx: number }
  /** Replace the streamed message with a shorter final one. */
  | { k: "finalize"; shrinkBy: number }
  /** Load `count` older messages above (captureForPrepend runs first). */
  | { k: "prepend"; count: number }
  /** Set the below-list chrome height — clientHeight moves, content doesn't. */
  | { k: "chromeResize"; px: number }
  /** An existing message grows in place (an image finishing decode). */
  | { k: "imageDecode"; msgIndex: number; px: number }
  /** A real wheel: dispatch the event AND move scrollTop, as a browser does. */
  | { k: "userWheel"; deltaY: number }
  /** A scrollbar-thumb drag: scrollTop write with no input event at all. */
  | { k: "userDrag"; toTop: number }
  /** Momentum: a run of scroll events with NO input events (the iOS fling the
   *  old controller had to guess about). Reversals are counted. */
  | { k: "fling"; steps: number; stepPx: number; intervalMs: number }
  /** The floating scroll-to-bottom button. */
  | { k: "button"; behavior: ScrollBehavior }
  /** Open a thread: empty the list and start the bounded open-phase hold. */
  | { k: "openThread" }
  /** The first history render has landed — end the hold. */
  | { k: "settleOpen" }
  /** Mobile keyboard: shrink the frame, hold, restore. */
  | { k: "keyboardClamp"; px: number; holdMs: number }
  | { k: "wait"; ms: number };

/** Declarative outcome check, evaluated against the run's measured summary. */
export interface Expectation {
  /** Within the at-bottom margin when the scenario ends. */
  finalAtBottom?: boolean;
  /** Distance from the bottom at the end, in px. */
  finalFromBottomAtMost?: number;
  /** Content must have grown past the fold and stayed there (no follow). */
  finalFromBottomAtLeast?: number;
  /** Worst drift off the bottom during any moment the controller claimed atBottom. */
  maxFromBottomWhileAtBottomAtMost?: number;
  /** The view left the bottom with no user input anywhere near it. */
  leftBottomWithoutIntent?: boolean;
  /** Scroll movement the controller caused while the reader was away from the bottom. */
  driftWhileAwayAtMost?: number;
  /** The "new content below" badge state at the end. */
  finalHasUnseenContent?: boolean;
  /** Offset of the newest user message from the scroller's top edge (the send anchor). */
  finalUserMessageTopAtMost?: number;
  /** Programmatic `scrollTop` writes the controller made during the run. */
  writesAtMost?: number;
  /** Backwards jumps in scrollTop observed during a fling — a yank. */
  flingReversalsAtMost?: number;
}

export interface Scenario {
  name: string;
  description: string;
  steps: Step[];
  expect: Expectation;
}

const STREAM_CHUNK_PX = 26;

export const SCENARIOS: Scenario[] = [
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
      finalAtBottom: false,
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
    description: "Rule 1, the load-with-images case: the history lands and the hold settles, then an image in the last message finishes fetching well after the settle window. The reader opened the thread at the bottom and has not touched it; they should still be at the bottom.",
    steps: [
      { k: "openThread" },
      { k: "wait", ms: 80 },
      { k: "append", px: 420, role: "assistant" },
      { k: "append", px: 60, role: "user" },
      { k: "append", px: 120, role: "assistant" },
      { k: "settleOpen" },
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
];

export function findScenario(name: string): Scenario | null {
  return SCENARIOS.find((s) => s.name === name) ?? null;
}
