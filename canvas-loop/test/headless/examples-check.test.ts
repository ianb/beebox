// The lines that fail an example: a framed warning or error, and a scripted
// input that engaged nothing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { transcriptProblems } from "../../src/headless/examples-check.js";

test("transcriptProblems finds framed warnings, errors and unhandled inputs, and nothing else", () => {
  const text = [
    "# canvas-loop transcript",
    "- events: `bounce-tea-events.json`",
    "**[frame 3]** warn: v.circle made a drawing that was not returned",
    "**[frame 4]** mousedown (180,216) on ball → grab",
    "**[frame 5]** mousedown (200,150) → (unhandled)",
    "**[frame 6]** keydown r → Δmodel",
    "**[frame 7]** log: the warn: in a log line is not a warning",
    "**[frame 8]** error: console.error from the sketch",
    "**[frame 120]** log: mousemove: 3 more unhandled (not listed)",
  ].join("\n");
  assert.deepEqual(transcriptProblems(text), [
    "**[frame 3]** warn: v.circle made a drawing that was not returned",
    "**[frame 5]** mousedown (200,150) → (unhandled)",
    "**[frame 8]** error: console.error from the sketch",
  ]);
});
