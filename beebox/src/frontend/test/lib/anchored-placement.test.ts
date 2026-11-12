// # Where an anchored layer goes
//
// `placeAnchored` places a menu, popover or floating button beside its anchor,
// flipping to the roomier side and never extending past the visible viewport.
// The viewport here is 400×600 with an 8px margin, a 4px gap and 16px rems.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { placeAnchored, type AnchorBox, type PlacementInput } from "../../src/lib/anchored-placement.js";

const VIEWPORT = { left: 0, top: 0, width: 400, height: 600 };

function place(over: Partial<PlacementInput> & { anchor: AnchorBox }) {
  return placeAnchored({
    size: { width: 192, height: 100 },
    viewport: VIEWPORT,
    align: "left",
    vertical: "below",
    gap: 4,
    margin: 8,
    rem: 16,
    ...over,
  });
}

function trigger(top: number, left: number): AnchorBox {
  return { top, bottom: top + 20, left, right: left + 40 };
}

function point(x: number, y: number): AnchorBox {
  return { top: y, bottom: y, left: x, right: x };
}

void test("a trigger with room below opens below, bounded by the viewport", async (t) => {
  t.check(place({ anchor: trigger(100, 50) }), { side: "below", top: 124, left: 50, maxHeight: 468, maxWidth: 384 });
});

void test("a trigger near the bottom opens above instead of getting a negative height", async (t) => {
  t.check(place({ anchor: trigger(560, 50) }), { side: "above", top: 456, left: 50, maxHeight: 548, maxWidth: 384 });
});

void test("a trigger below the visible viewport (the iOS keyboard) still gets a non-negative height", async (t) => {
  const result = place({ anchor: trigger(500, 50), viewport: { ...VIEWPORT, height: 300 } });
  t.check(result, { side: "above", top: 192, left: 50, maxHeight: 284, maxWidth: 384 });
});

void test("above is kept when it has room for the content", async (t) => {
  t.check(place({ anchor: trigger(300, 50), vertical: "above" }), { side: "above", top: 196, left: 50, maxHeight: 288, maxWidth: 384 });
});

void test("a preferred side with less than 12rem of room flips when the other side has more", async (t) => {
  t.check(place({ anchor: trigger(120, 50), vertical: "above", size: { width: 192, height: 400 } }), {
    side: "below", top: 144, left: 50, maxHeight: 448, maxWidth: 384,
  });
});

void test("short content stays on the preferred side even when that side is smaller", async (t) => {
  t.check(place({ anchor: trigger(60, 50), vertical: "above", size: { width: 192, height: 40 } }), {
    side: "above", top: 16, left: 50, maxHeight: 48, maxWidth: 384,
  });
});

void test("a bottom-right point opens up and to the left", async (t) => {
  t.check(place({ anchor: point(390, 590) }), { side: "above", top: 486, left: 198, maxHeight: 578, maxWidth: 384 });
});

void test("right alignment puts the layer's right edge at the anchor's right edge", async (t) => {
  t.check(place({ anchor: trigger(100, 300), align: "right" }).left, 148);
});

void test("a layer wider than the viewport is clamped to it", async (t) => {
  t.check(place({ anchor: trigger(100, 300), size: { width: 900, height: 100 } }), { side: "below", top: 124, left: 8, maxHeight: 468, maxWidth: 384 });
});

void test("when neither side has 8rem the layer takes the whole visible viewport and scrolls", async (t) => {
  const viewport = { left: 0, top: 0, width: 400, height: 200 };
  t.check(place({ anchor: trigger(90, 50), viewport, size: { width: 192, height: 400 } }), {
    side: "viewport-top", top: 8, left: 50, maxHeight: 184, maxWidth: 384,
  });
});

void test("a viewport shorter than 8rem still contains the layer", async (t) => {
  const viewport = { left: 0, top: 0, width: 400, height: 100 };
  t.check(place({ anchor: trigger(40, 50), viewport, size: { width: 192, height: 300 } }), {
    side: "viewport-top", top: 8, left: 50, maxHeight: 84, maxWidth: 384,
  });
});

void test("a viewport smaller than its margins gives zero sizes, never negative ones", async (t) => {
  const viewport = { left: 0, top: 0, width: 10, height: 10 };
  const result = place({ anchor: point(5, 5), viewport });
  t.check({ maxHeight: result.maxHeight, maxWidth: result.maxWidth }, { maxHeight: 0, maxWidth: 0 });
});

void test("a scrolled visual viewport offsets the bounds", async (t) => {
  const viewport = { left: 0, top: 200, width: 400, height: 300 };
  t.check(place({ anchor: trigger(220, 50), viewport }), { side: "below", top: 244, left: 50, maxHeight: 248, maxWidth: 384 });
});
