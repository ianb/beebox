// Backdrop scoring: artwork must fill its box, with no repeat seam and no
// bare strip.

import { test } from "tap";
import { describeBackdropFailure, scoreBackdrops, type BackdropLayer } from "./tour-lib/backdrop.js";

function layer(over: Partial<BackdropLayer>): BackdropLayer {
  return {
    selector: "div.bbx-box-presentation",
    image: "art.webp",
    box: { w: 430, h: 932 },
    tile: { w: 1380, h: 920 },
    offset: { x: -475, y: 0 },
    repeat: { x: true, y: true },
    ...over,
  };
}

void test("a tile shorter than its box repeats", (t) => {
  const failures = scoreBackdrops([layer({})]);
  t.check(failures.map((f) => describeBackdropFailure(f)), ["art.webp repeats down div.bbx-box-presentation: 920px tile in a 932px box"]);
  t.end();
});

void test("a tile that fills its box passes, within a pixel of rounding", (t) => {
  t.check(scoreBackdrops([layer({ tile: { w: 1398, h: 932.4 } })]), []);
  t.check(scoreBackdrops([layer({ tile: { w: 1380, h: 931.5 } })]), []);
  t.end();
});

void test("an unrepeated image that stops short leaves a bare strip", (t) => {
  const short = layer({ repeat: { x: false, y: false } });
  t.check(scoreBackdrops([short]).map((f) => describeBackdropFailure(f)), ["art.webp leaves 12px bare at the bottom of div.bbx-box-presentation: 920px image in a 932px box"]);
  const centered = layer({ box: { w: 1366, h: 58 }, tile: { w: 800, h: 450 }, offset: { x: 283, y: -196 }, repeat: { x: false, y: false } });
  t.check(scoreBackdrops([centered]).map((f) => describeBackdropFailure(f)), ["art.webp leaves 283px bare at the left of div.bbx-box-presentation: 800px image in a 1366px box"]);
  t.end();
});

void test("each axis is judged by its own repeat", (t) => {
  const wide = layer({ box: { w: 1920, h: 58 }, tile: { w: 1300, h: 867 }, offset: { x: 310, y: -100 }, repeat: { x: true, y: false } });
  t.check(scoreBackdrops([wide]).map((f) => `${f.kind} ${f.axis}`), ["repeats x"]);
  t.end();
});
