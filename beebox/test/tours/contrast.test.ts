// Contrast scoring over a glyph-free capture: thresholds, the percentile that
// tolerates texture but not a band, faded groups, and material surfaces.

import { test } from "tap";
import { composite, contrastRatio, mergeContrastSteps, scoreMaterials, scoreRuns, type ContrastFailure, type RawImage } from "./tour-lib/contrast.js";
import type { Material, TextRun } from "./tour-lib/contrast-page.js";

type Rgb = [number, number, number];

/** A 100×10 image whose columns before `split` are `left` and the rest `right`. */
function image({ left, right, split }: { left: Rgb; right?: Rgb; split?: number }): RawImage {
  const width = 100;
  const height = 10;
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = x < (split ?? width) ? left : right ?? left;
      data.set(c, (y * width + x) * 3);
    }
  }
  return { data, width, height, channels: 3 };
}

function run(over: Partial<TextRun>): TextRun {
  return { id: 0, selector: "p", text: "Sample", fg: [0, 0, 0, 1], group: null, large: false, placeholder: false, material: -1, rects: [{ x: 0, y: 0, w: 100, h: 10 }], ...over };
}

function page(runs: TextRun[], materials?: Material[]): { width: number; runs: TextRun[]; materials: Material[] } {
  return { width: 100, runs, materials: materials ?? [] };
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

void test("contrast ratio matches WCAG's reference points", (t) => {
  t.check(r2(contrastRatio([0, 0, 0], [255, 255, 255])), 21);
  // #767676 is the lightest grey that passes AA on white.
  t.check(r2(contrastRatio([0x76, 0x76, 0x76], [255, 255, 255])), 4.54);
  t.check(r2(contrastRatio([0x77, 0x77, 0x77], [255, 255, 255])), 4.48);
  t.end();
});

void test("normal text needs 4.5:1; large text and a placeholder 3:1", (t) => {
  const grey: TextRun["fg"] = [0x90, 0x90, 0x90, 1];
  const white = image({ left: [255, 255, 255] });
  t.check(scoreRuns(white, page([run({ fg: grey })])).map((f) => [f.kind, f.ratio]), [["text", 3.19]]);
  t.check(scoreRuns(white, page([run({ fg: grey, large: true })])), []);
  t.check(scoreRuns(white, page([run({ fg: grey, placeholder: true })])), []);
  t.end();
});

void test("a texture speck passes; a band wider than the percentile fails", (t) => {
  const speck = image({ left: [40, 40, 40], right: [255, 255, 255], split: 5 });
  t.check(scoreRuns(speck, page([run({})])), []);
  const band = image({ left: [40, 40, 40], right: [255, 255, 255], split: 20 });
  t.check(scoreRuns(band, page([run({})])).map((f) => f.kind === "text" && f.bg), ["#282828"]);
  t.end();
});

void test("translucent text is composited over each sample", (t) => {
  // Black at 30% over white reads as light grey.
  t.check(scoreRuns(image({ left: [255, 255, 255] }), page([run({ fg: [0, 0, 0, 0.3] })])).map((f) => f.ratio), [2.11]);
  t.end();
});

void test("a faded group fades its own background with the text", (t) => {
  // Black text on a white panel at 50% opacity over a black backdrop: the
  // capture shows the panel as mid grey, and the text stays black on it.
  const sample: Rgb = [127.5, 127.5, 127.5];
  const [text, bg] = composite({ fg: [0, 0, 0, 1], group: { opacity: 0.5, bg: [255, 255, 255] } }, sample);
  t.check(text.map(Math.round), [0, 0, 0]);
  t.check(Math.round(contrastRatio(text, bg) * 10) / 10, 5.3);
  t.end();
});

const dark: Material = {
  theme: "deck/panels",
  paper: [41, 49, 46],
  surfaces: [[41, 49, 46], [16, 39, 45]],
  pairs: [{ fg: "ink", bg: "sheet", fgColor: [216, 244, 239, 1], bgColor: [143, 147, 144] }],
  at: { x: 0, y: 0, w: 1, h: 1 },
};

void test("readable text on an undeclared surface that inverts the paper is a surface break", (t) => {
  const panel = scoreRuns(image({ left: [255, 255, 255] }), page([run({ material: 0 })], [dark]));
  t.check(panel.map((f) => f.kind === "surface" && f.bg), ["#ffffff"]);
  // The declared code paper is part of the material, however dark.
  t.check(scoreRuns(image({ left: [16, 39, 45] }), page([run({ fg: [216, 244, 239, 1], material: 0 })], [dark])), []);
  t.end();
});

void test("token pairs below AA are named by token", (t) => {
  t.check(scoreMaterials([dark]).map((f) => f.kind === "token" && `${f.fg} on ${f.bg} ${String(f.ratio)}`), ["--bbx-ink on --bbx-sheet 2.68"]);
  t.end();
});

void test("audits at several scroll positions merge by run and line", (t) => {
  const text = (id: number, ratio: number): ContrastFailure => ({ kind: "text", run: id, selector: "p", text: "Sample", fg: "#777777", bg: "#ffffff", ratio, required: 4.5 });
  const token: ContrastFailure = { kind: "token", material: 0, theme: "gilt/leaf", fg: "--bbx-ink-soft", bg: "--bbx-paper", ratio: 3.9, required: 4.5 };
  const merged = mergeContrastSteps([
    // Top of the page: run 1 whole; run 2's second line cut by the bottom edge; runs 3 and 5 below.
    { failures: [text(2, 4.1), token], runs: [1, 2], lines: [{ id: 1, label: "p 1", total: 1, whole: [0] }, { id: 2, label: "p 2", total: 2, whole: [0] }, { id: 3, label: "p 3", total: 3, whole: [] }, { id: 5, label: "p 5", total: 1, whole: [] }], unmeasured: [] },
    // One step down: run 2's second line, failing lower; run 3 taller than the screen; run 4 covered.
    { failures: [text(2, 3.8), token], runs: [2, 3], lines: [{ id: 2, label: "p 2", total: 2, whole: [1] }, { id: 3, label: "p 3", total: 3, whole: [0, 1] }, { id: 4, label: "p 4", total: 1, whole: [] }], unmeasured: [4] },
    // Last step: run 3's last line, so every line of it was seen; run 5 never was.
    { failures: [], runs: [3], lines: [{ id: 3, label: "p 3", total: 3, whole: [2] }, { id: 4, label: "p 4", total: 1, whole: [] }], unmeasured: [4] },
  ]);
  t.check(merged, { failures: [text(2, 3.8), token], runs: 3, offscreen: ["p 5"], unmeasured: ["p 4"] });
  t.end();
});

void test("a line box with a fractional edge samples only the pixels it covers whole", (t) => {
  // Row 0 is the panel above a scroller; the line starts 0.6px into it.
  const width = 100;
  const data = new Uint8Array(width * 10 * 3).fill(255);
  data.fill(0xa0, 0, width * 3);
  const edge: RawImage = { data, width, height: 10, channels: 3 };
  t.check(scoreRuns(edge, page([run({ fg: [0x76, 0x76, 0x76, 1], rects: [{ x: 0, y: 0.6, w: 100, h: 4.4 }] })])), []);
  t.end();
});
