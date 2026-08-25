/**
 * Scenario scripts for the dev scroll harness (/dev/chat-scroll).
 *
 * A scenario is a list of timed steps plus the outcome it expects, so a run is
 * an assertion rather than a thing to eyeball. Steps model the real forces on
 * the chat scroller — stream growth, finalize shrink, older-history prepend,
 * below-list chrome resizing, a late-decoding image above the viewport — and
 * the two kinds of user scroll the controller has to tell apart (a wheel, which
 * fires an input event, and a scrollbar-thumb drag, which does not).
 *
 * Runner + measurement live in chat-scroll-runner.ts; this file is data.
 */

export type Step =
  /** A new message of `px` height lands at the bottom. */
  | { k: "append"; px: number; role: "user" | "assistant" }
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
  /** Mobile keyboard: shrink the frame, hold, restore. */
  | { k: "keyboardClamp"; px: number; holdMs: number }
  | { k: "wait"; ms: number };

/** Declarative outcome check, evaluated against the run's measured summary. */
export interface Expectation {
  /** Following the bottom when the scenario ends. */
  finalPinned?: boolean;
  /** Distance from the bottom at the end, in px. */
  finalFromBottomAtMost?: number;
  /** Worst drift off the bottom during any moment the controller claimed pinned. */
  maxFromBottomWhilePinnedAtMost?: number;
  /** Following stopped with no user input anywhere near it. */
  disengagedWithoutIntent?: boolean;
  /** Scroll movement the controller caused while the user was reading detached. */
  driftWhileDetachedAtMost?: number;
  /** The "new content below" badge state at the end. */
  finalHasUnseenContent?: boolean;
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
    description: "At the bottom, an ordinary streamed reply. The view must ride the growth.",
    steps: [
      { k: "append", px: 40, role: "user" },
      { k: "append", px: 48, role: "assistant" },
      { k: "stream", chunks: 24, intervalMs: 60, chunkPx: STREAM_CHUNK_PX },
      { k: "wait", ms: 200 },
    ],
    expect: {
      finalPinned: true,
      finalFromBottomAtMost: 4,
      maxFromBottomWhilePinnedAtMost: 8,
      disengagedWithoutIntent: false,
      finalHasUnseenContent: false,
    },
  },
  {
    name: "scroll-up-mid-stream",
    description: "The user wheels up while a reply streams: following stops and stays stopped, and the reading position must not be dragged around.",
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
      finalPinned: false,
      disengagedWithoutIntent: false,
      driftWhileDetachedAtMost: 6,
      finalHasUnseenContent: true,
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
      { k: "imageDecode", msgIndex: 2, px: 180 },
      { k: "wait", ms: 250 },
    ],
    expect: {
      finalPinned: false,
      driftWhileDetachedAtMost: 6,
      finalHasUnseenContent: false,
    },
  },
  {
    name: "chrome-grows",
    description: "Below-list chrome (attachment row / mobile composer) grows and shrinks while pinned. Content height never changes; clientHeight does.",
    steps: [
      { k: "wait", ms: 150 },
      { k: "chromeResize", px: 260 },
      { k: "wait", ms: 250 },
      { k: "chromeResize", px: 96 },
      { k: "wait", ms: 250 },
      { k: "keyboardClamp", px: 220, holdMs: 300 },
      { k: "wait", ms: 250 },
    ],
    expect: {
      finalPinned: true,
      finalFromBottomAtMost: 4,
      maxFromBottomWhilePinnedAtMost: 8,
      disengagedWithoutIntent: false,
    },
  },
  {
    name: "finalize-shrinks",
    description: "A streamed reply is replaced by a shorter finalized one — content shrinks under a pinned view.",
    steps: [
      { k: "append", px: 40, role: "user" },
      { k: "append", px: 48, role: "assistant" },
      { k: "stream", chunks: 18, intervalMs: 50, chunkPx: STREAM_CHUNK_PX },
      { k: "finalize", shrinkBy: 240 },
      { k: "wait", ms: 300 },
    ],
    expect: {
      finalPinned: true,
      finalFromBottomAtMost: 4,
      disengagedWithoutIntent: false,
      finalHasUnseenContent: false,
    },
  },
  {
    name: "fast-growth-hands-off",
    description: "The open bug: start at the bottom, stream fast, touch nothing. Any drift or disengage here is the controller losing the race with growth.",
    steps: [
      { k: "append", px: 40, role: "user" },
      { k: "append", px: 48, role: "assistant" },
      { k: "stream", chunks: 60, intervalMs: 16, chunkPx: 44 },
      { k: "wait", ms: 300 },
    ],
    expect: {
      finalPinned: true,
      finalFromBottomAtMost: 4,
      maxFromBottomWhilePinnedAtMost: 8,
      disengagedWithoutIntent: false,
      finalHasUnseenContent: false,
    },
  },
];

export function findScenario(name: string): Scenario | null {
  return SCENARIOS.find((s) => s.name === name) ?? null;
}
