// # canvas-loop's examples reach a box agent
//
// Plan: `plan:canvas-loop-examples.subplan`, Track F. `canvas-loop-examples.md` holds a
// section for every example in canvas-loop's `src/examples/`, and every link
// to an example in canvas-loop's TEA.md, BRUSHES.md and README.md names one
// that exists. In the box docs, TEA.md's and BRUSHES.md's example links land
// on a section of `canvas-loop-examples.md`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";
import {
  canvasLoopExampleNames,
  generateCanvasLoopBrushesDoc,
  generateCanvasLoopDoc,
  generateCanvasLoopExamplesDoc,
} from "../../../src/core/docs-gen/package-docs/canvas-loop-doc.js";

const CANVAS_LOOP = path.join(PACKAGE_ROOT, "..", "canvas-loop");
const EXAMPLE_LINK = /]\(\.\/src\/examples\/([\w-]+?)-tea(?:-events\.json|\.ts)\)/g;
const BOX_LINK = /]\(canvas-loop-examples\.md#([\w-]+)\)/g;

const linked = (text: string, pattern: RegExp): string[] => [...text.matchAll(pattern)].map((m) => m[1] ?? "");
const distinct = (names: readonly string[]): string[] => [...new Set(names)].toSorted();
const EXAMPLES = ["answer-box", "bounce", "brushes", "effects", "lamps", "looks", "night-room", "orbit", "paint", "paint-mixing", "pendulum", "scale", "sound"];

void test("the examples doc has a section for every example, in name order", async (t) => {
  t.check(canvasLoopExampleNames(), EXAMPLES);
  t.check(linked(generateCanvasLoopExamplesDoc(), /^## ([\w-]+)$/gm), EXAMPLES);
});

// A link to an example that was renamed or retired fails here; the lists also
// show which examples each doc links.
void test("every example link in TEA.md, BRUSHES.md and README.md names an example that exists", async (t) => {
  const links = async (doc: string): Promise<string[]> => distinct(linked(await fs.readFile(path.join(CANVAS_LOOP, doc), "utf8"), EXAMPLE_LINK));
  t.check(await links("TEA.md"), ["answer-box", "bounce", "effects", "lamps", "orbit", "paint", "pendulum", "scale", "sound"]);
  t.check(await links("BRUSHES.md"), ["brushes", "effects", "lamps", "looks", "night-room", "paint", "paint-mixing"]);
  t.check(await links("README.md"), EXAMPLES);
});

void test("in the box docs, TEA.md's and BRUSHES.md's example links land on sections of the examples doc", async (t) => {
  const tea = generateCanvasLoopDoc();
  const brushes = generateCanvasLoopBrushesDoc();
  t.check(distinct(linked(tea, BOX_LINK)), ["answer-box", "bounce", "effects", "lamps", "orbit", "paint", "pendulum", "scale", "sound"]);
  t.check(distinct(linked(brushes, BOX_LINK)), ["brushes", "effects", "lamps", "looks", "night-room", "paint", "paint-mixing"]);
  // No checkout path to an example is left for the box agent.
  t.check(linked(tea + brushes, EXAMPLE_LINK), []);
});
