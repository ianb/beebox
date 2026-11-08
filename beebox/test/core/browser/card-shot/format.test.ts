// The lines `screenshot --card` prints: whole or partial (in both dimensions,
// from the measures), overflow findings, and a view error.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { formatCardShot } from "../../../../src/core/browser/card-shot/format.js";
import type { FoundMeasure } from "../../../../src/core/browser/card-shot/measure.js";

const WHOLE: FoundMeasure = {
  found: true,
  url: "http://localhost:3210/wt/test1/views/_content/a.card",
  card: { width: 366, height: 2027 },
  painted: { x: 0, y: 0, width: 366, height: 2027 },
  viewport: { width: 390, height: 2184 },
  dpr: 1,
  overflow: [{ tag: "div", text: "Scale: 0.5x 1x 1.5x 2x 3x", excess: 25 }],
  errorText: null,
  busy: false,
};

void test("a whole card, with an overflow finding", (t) => {
  t.check(formatCardShot({ cardPath: "_content/a.card", imagePath: "/box/_tmp/browser/card-a.card-390px.png", measure: WHOLE }), [
    "✓ Screenshot saved to /box/_tmp/browser/card-a.card-390px.png",
    "card: _content/a.card at 390px wide — whole card (366×2027)",
    'overflow: <div> "Scale: 0.5x 1x 1.5x 2x 3x" is 25px wider than its box',
    "",
  ].join("\n"));
  t.end();
});

void test("a card taller than the capture and wider than its panel says what is missing", (t) => {
  const partial: FoundMeasure = { ...WHOLE, card: { width: 500, height: 12000 }, painted: { x: 0, y: 0, width: 366, height: 7900 }, overflow: [], errorText: "View Error TypeError: x is undefined", busy: true };
  t.check(formatCardShot({ cardPath: "_content/a.card", imagePath: "/i.png", measure: partial }), [
    "✓ Screenshot saved to /i.png",
    "card: _content/a.card at 390px wide — partial: the image shows 7900px of the card's 12000px height, from 0px down; it shows 366px of the card's 500px width",
    "view error: View Error TypeError: x is undefined",
    "still loading: part of the card was still loading when it was captured; this image may not show the finished view",
    "",
  ].join("\n"));
  t.end();
});
