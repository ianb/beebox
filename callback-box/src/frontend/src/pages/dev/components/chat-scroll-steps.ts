/**
 * The step vocabulary of the dev scroll harness (/dev/chat-scroll). Each step
 * models one real force on the chat scroller; the scenarios that compose them
 * live in chat-scroll-scenarios.ts, the runner in chat-scroll-runner.ts.
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
  /** Grow the last message, then grow it AGAIN inside the same resize-observer
   *  pass — after the controller's write, before the browser delivers that
   *  write's scroll event. A real thread does this on every load. */
  | { k: "growTwiceInOnePass"; px: number; againPx: number }
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
  /** The first history render has landed — end the hold. With `awaitImage`,
   *  the hold waits for the next `imageDecode` step first, the way the real
   *  controller waits for the transcript's nearby images. */
  | { k: "settleOpen"; awaitImage?: boolean }
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
