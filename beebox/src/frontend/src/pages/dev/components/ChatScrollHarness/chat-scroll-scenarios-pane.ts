/**
 * Card-pane scenarios for the dev scroll harness: the chat shares a flex row
 * with the card pane, so opening or closing a card (or resizing the window)
 * changes the scroller's width and rewraps every message. A reader at the
 * bottom stays at the bottom; a reader mid-log keeps their reading point.
 */

import type { Scenario } from "./chat-scroll-steps";

export const PANE_SCENARIOS: Scenario[] = [
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
    name: "pane-open-preserves-reading-anchor",
    description: "A reader partway through a wide transcript opens a card beside it. The transcript narrows and rewraps taller; the visible reading point must stay on screen.",
    steps: [
      { k: "wrapWidth", px: 900 },
      { k: "userDrag", toTop: 900, observeReadingPosition: true },
      { k: "resizeWidth", px: 460 },
      { k: "wait", ms: 300 },
    ],
    expect: {
      finalAtBottom: false,
      driftWhileAwayAtMost: 8,
    },
  },
  {
    name: "pane-close-keeps-bottom",
    description: "The 2026-10-12 desktop repro: at the bottom of a narrow transcript, close the card. The content gets shorter, the browser clamps first, and the reader must still be at the bottom.",
    steps: [
      { k: "wrapWidth", px: 460 },
      { k: "button", behavior: "instant" },
      { k: "wait", ms: 150 },
      { k: "resizeWidth", px: 900 },
      { k: "wait", ms: 300 },
    ],
    expect: {
      finalAtBottom: true,
      finalFromBottomAtMost: 4,
      leftBottomWithoutIntent: false,
    },
  },
  {
    name: "pane-open-keeps-bottom",
    description: "At the bottom of a wide transcript, open a card. The content rewraps taller above the reader; the bottom stays the bottom.",
    steps: [
      { k: "wrapWidth", px: 900 },
      { k: "button", behavior: "instant" },
      { k: "wait", ms: 150 },
      { k: "resizeWidth", px: 460 },
      { k: "wait", ms: 300 },
    ],
    expect: {
      finalAtBottom: true,
      finalFromBottomAtMost: 4,
      leftBottomWithoutIntent: false,
    },
  },
];
