// # Capture anchor: what the chat list puts at the top after Done in capture
//
// Done in capture should anchor like a typed send. The capture's message
// arrives from the box seconds after Done, so the list waits: it anchors the
// new capture bubble when that appears, then the capture message when it
// arrives. "New" means "not in the list at Done".

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { startCaptureWait, stepCaptureWait } from "../../../../../src/components/chat/everywhere/InteractiveChat/capture-anchor.js";

// The bubble appears first and is anchored once; the message arrives later,
// is anchored, and ends the wait:
void test("The bubble appears first and is anchored once; the message arrives later, is...", async (t) => {
  // doctest:L16
  const wait = startCaptureWait({ newestCapture: "u-earlier-capture", bubbleIds: [] });
  let r = stepCaptureWait(wait, { newestCapture: "u-earlier-capture", bubbleIds: [], readerScrolled: false });
  t.check(r.step, {
    anchor: "none",
  });

  // doctest:L21
  r = stepCaptureWait(r.wait!, { newestCapture: "u-earlier-capture", bubbleIds: ["cap-1"], readerScrolled: false });
  t.check(r.step, {
    anchor: "bubble",
    index: 0,
  });

  // doctest:L25
  r = stepCaptureWait(r.wait!, { newestCapture: "u-earlier-capture", bubbleIds: ["cap-1"], readerScrolled: false });
  t.check(r.step, {
    anchor: "none",
  });

  // doctest:L29
  r = stepCaptureWait(r.wait!, { newestCapture: "u-capture", bubbleIds: [], readerScrolled: false });
  t.check([r.step, r.wait], [
    {
      anchor: "user",
    },
    null,
  ]);
});

// A bubble already on screen from an earlier capture is not this capture's;
// the new one is found by id at its own index:
void test("A bubble already on screen from an earlier capture is not this capture's; the...", async (t) => {
  // doctest:L38
  const wait = startCaptureWait({ newestCapture: "u-1", bubbleIds: ["cap-old"] });
  t.check(stepCaptureWait(wait, { newestCapture: "u-1", bubbleIds: ["cap-old", "cap-new"], readerScrolled: false }).step, {
    anchor: "bubble",
    index: 1,
  });
});

// Loading older history adds messages above the newest capture message. The
// newest is unchanged, so nothing is anchored and the wait goes on. The same
// holds for a typed message from another tab: it is not a capture message, so
// the newest capture message is unchanged:
void test("Loading older history adds messages above the newest capture message.", async (t) => {
  // doctest:L49
  const wait = startCaptureWait({ newestCapture: "u-5", bubbleIds: [] });
  const r = stepCaptureWait(wait, { newestCapture: "u-5", bubbleIds: [], readerScrolled: false });
  t.check([r.step, r.wait === wait], [
    {
      anchor: "none",
    },
    true,
  ]);
});

// A chat with no user message yet still recognizes the first one:
void test("A chat with no user message yet still recognizes the first one:", async (t) => {
  // doctest:L58
  const wait = startCaptureWait({ newestCapture: null, bubbleIds: [] });
  t.check(stepCaptureWait(wait, { newestCapture: "u-capture", bubbleIds: [], readerScrolled: false }).step, {
    anchor: "user",
  });
});

// A reader who scrolled the chat themselves after the bubble was anchored stays
// where they are when the message arrives, and the wait ends. Scrolling before
// the bubble anchor does not count; the anchor moved them anyway:
void test("A reader who scrolled the chat themselves after the bubble was anchored stays...", async (t) => {
  // doctest:L68
  const anchored = stepCaptureWait(startCaptureWait({ newestCapture: null, bubbleIds: [] }), { newestCapture: null, bubbleIds: ["cap-1"], readerScrolled: false }).wait!;
  const scrolled = stepCaptureWait(anchored, { newestCapture: "u-capture", bubbleIds: [], readerScrolled: true });
  const unanchored = stepCaptureWait(startCaptureWait({ newestCapture: null, bubbleIds: [] }), { newestCapture: "u-capture", bubbleIds: [], readerScrolled: true });
  t.check([scrolled.step, scrolled.wait, unanchored.step], [
    {
      anchor: "none",
    },
    null,
    {
      anchor: "user",
    },
  ]);
});
