import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutText } from "../../../src/core/painter/text-layout.js";

// Every character is half the size wide: easy arithmetic.
const measure = (text: string, size: number): number => text.length * size * 0.5;

test("words wrap to the box width and explicit newlines break", () => {
  const out = layoutText("aa bb cc\ndd", { size: 10, box: { x: 0, y: 0, w: 30 }, options: {}, measure });
  assert.deepEqual(out.lines.map((line) => line.text), ["aa bb", "cc", "dd"]);
  assert.equal(out.overflow, false);
});

test("center and middle place text about a point when the box has no size", () => {
  const out = layoutText("abcd", { size: 10, box: { x: 50, y: 20 }, options: { align: "center", valign: "middle" }, measure });
  assert.equal(out.x, 40);
  assert.equal(out.lines[0]?.y, 20);
});

test("right and bottom align inside a box", () => {
  const out = layoutText("ab", { size: 10, box: { x: 0, y: 0, w: 100, h: 50 }, options: { align: "right", valign: "bottom" }, measure });
  assert.equal(out.x, 90);
  assert.equal(out.y + out.h, 50);
});

test("fit shrinks the size until the text fits, and reports overflow when it cannot", () => {
  const fits = layoutText("abcdefgh", { size: 20, box: { x: 0, y: 0, w: 40, h: 30 }, options: { fit: true, wrap: false }, measure });
  assert.ok(fits.size <= 10 && fits.size > 9, `size ${fits.size}`);
  assert.equal(fits.overflow, false);
  const over = layoutText("abcdefgh", { size: 20, box: { x: 0, y: 0, w: 40, h: 30 }, options: { wrap: false }, measure });
  assert.equal(over.overflow, true);
  assert.equal(over.size, 20);
});
