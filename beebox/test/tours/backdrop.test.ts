// Backdrop scoring: artwork must fill its box, with no repeat seam and no
// bare strip.

import { test } from "tap";
import { describeBackdropFailure, scoreBackdrops, type BackdropLayer } from "./tour-lib/backdrop.js";

function layer(over: Partial<BackdropLayer>): BackdropLayer {
  return {
    selector: "div.bbx-box-presentation",
    image: "art.webp",
    raster: true,
    natural: { w: 1536, h: 1024 },
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
  t.check(scoreBackdrops([layer({ tile: { w: 1397, h: 931.5 } })]), []);
  t.end();
});

void test("an unrepeated image that stops short leaves a bare strip", (t) => {
  const short = layer({ repeat: { x: false, y: false } });
  t.check(scoreBackdrops([short]).map((f) => describeBackdropFailure(f)), ["art.webp leaves 12px bare at the bottom of div.bbx-box-presentation: 920px image in a 932px box"]);
  const centered = layer({ box: { w: 1366, h: 58 }, tile: { w: 800, h: 533 }, offset: { x: 283, y: -237 }, repeat: { x: false, y: false } });
  t.check(scoreBackdrops([centered]).map((f) => describeBackdropFailure(f)), ["art.webp leaves 283px bare at the left of div.bbx-box-presentation: 800px image in a 1366px box"]);
  t.end();
});

void test("each axis is judged by its own repeat", (t) => {
  const wide = layer({ box: { w: 1920, h: 58 }, tile: { w: 1300, h: 867 }, offset: { x: 310, y: -100 }, repeat: { x: true, y: false } });
  t.check(scoreBackdrops([wide]).map((f) => `${f.kind} ${f.axis}`), ["repeats x"]);
  t.end();
});

void test("an SVG may repeat, as a pattern, but not stop short", (t) => {
  const pattern = layer({ image: "weave.svg", raster: false, natural: { w: 120, h: 120 }, tile: { w: 120, h: 120 }, offset: { x: 0, y: 0 } });
  t.check(scoreBackdrops([pattern]), []);
  const panel = layer({ image: "panels.svg", raster: false, repeat: { x: false, y: false } });
  t.check(scoreBackdrops([panel]).map((f) => describeBackdropFailure(f)), ["panels.svg leaves 12px bare at the bottom of div.bbx-box-presentation: 920px image in a 932px box"]);
  t.end();
});

void test("painted artwork keeps its aspect ratio; cropping is fine", (t) => {
  const stretched = layer({ tile: { w: 430, h: 932 }, offset: { x: 0, y: 0 } });
  t.check(scoreBackdrops([stretched]).map((f) => describeBackdropFailure(f)), ["art.webp is stretched in div.bbx-box-presentation: 1536px×1024px painted at 430px×932px"]);
  const cropped = layer({ tile: { w: 1398, h: 932 }, offset: { x: -484, y: 0 }, repeat: { x: false, y: false } });
  t.check(scoreBackdrops([cropped]), []);
  t.end();
});

void test("a one-pixel squeeze is a distortion, and an SVG is judged too", (t) => {
  const squeezed = layer({ tile: { w: 1521, h: 1024 }, offset: { x: -545, y: 0 }, repeat: { x: false, y: false } });
  t.check(scoreBackdrops([squeezed]).map((f) => `${f.kind} ${f.axis}`), ["distorts y"]);
  const unratioed = layer({ image: "cutouts.svg", raster: false, natural: { w: 300, h: 150 }, box: { w: 375, h: 667 }, tile: { w: 375, h: 667 }, offset: { x: 0, y: 0 }, repeat: { x: false, y: false } });
  t.check(scoreBackdrops([unratioed]).map((f) => describeBackdropFailure(f)), ["cutouts.svg is stretched in div.bbx-box-presentation: 300px×150px painted at 375px×667px"]);
  t.end();
});
