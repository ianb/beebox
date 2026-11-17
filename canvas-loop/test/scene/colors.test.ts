// Perceptual CSS colours (colors.ts), parsed by canvas-loop itself in both
// runtimes, beside the colours the runtime's 2D context parses.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import type { Ctx2D } from "../../src/core/ctx2d.js";
import { SketchUsageError } from "../../src/core/errors.js";
import { colorsFrom } from "../../src/scene/colors.js";
import type { Rgba } from "../../src/scene/colors.js";

// eslint-disable-next-line no-restricted-syntax -- structural-context boundary: SKRSContext2D is a superset of Ctx2D, as in src/device/open.ts
const parse = colorsFrom(createCanvas(1, 1).getContext("2d") as unknown as Ctx2D);

const near = (actual: Rgba, want: { is: readonly number[]; label: string }): void => {
  assert.ok(actual.every((c, i) => Math.abs(c - (want.is[i] ?? Number.NaN)) < 0.003), `${want.label}: ${actual.join(", ")} is not ${want.is.join(", ")}`);
};

test("oklch and oklab read as CSS Color 4 defines them: numbers or percentages, hue units, an alpha after a slash", () => {
  near(parse("oklch(0.627955 0.257683 29.2339)"), { is: [1, 0, 0, 1], label: "sRGB red" });
  near(parse("oklch(62.7955% 64.42% 29.2339deg)"), { is: [1, 0, 0, 1], label: "percentages (chroma 100% is 0.4)" });
  near(parse("oklab(0.627955 0.224863 0.125846)"), { is: [1, 0, 0, 1], label: "red as oklab" });
  near(parse("OKLCH(0.519752 0.176858 0.39591turn / 50%)"), { is: [0, 128 / 255, 0, 0.5], label: "CSS green, a hue in turns, half alpha" });
  near(parse("oklab(1 0 0)"), { is: [1, 1, 1, 1], label: "white" });
  near(parse("oklch(0 0.2 120)"), { is: [0, 0, 0, 1], label: "black keeps no chroma" });
});

test("a colour outside sRGB keeps its lightness and hue and loses chroma until it fits", () => {
  const [r, g, b] = parse("oklch(0.7 0.4 140)");
  assert.ok([r, g, b].every((c) => c >= 0 && c <= 1));
  assert.ok(g > r && g > b, "still green");
  near(parse("oklch(0.7 0.4 140)"), { is: parse("oklch(0.7 0.4 140)"), label: "the same every time" });
});

test("color-mix mixes in oklab, oklch or srgb, with CSS's percentage rules", () => {
  near(parse("color-mix(in srgb, #ff0000 25%, #0000ff)"), { is: [0.25, 0, 0.75, 1], label: "25% red" });
  near(parse("color-mix(in srgb, 30% #ff0000, #0000ff 30%)"), { is: [0.5, 0, 0.5, 0.6], label: "shares under 100% scale alpha" });
  near(parse("color-mix(in oklab, white, black)"), { is: parse("oklab(0.5 0 0)"), label: "halfway in lightness" });
  const viaLch = parse("color-mix(in oklch, oklch(0.6 0.15 350), oklch(0.6 0.15 30))");
  near(viaLch, { is: parse("oklch(0.6 0.15 10)"), label: "the short way round the hue circle" });
  near(parse("color-mix(in oklab, rgba(255, 0, 0, 0) 50%, #0000ff)"), { is: parse("color-mix(in oklab, #0000ff, #0000ff)").map((c, i) => (i === 3 ? 0.5 : c)), label: "a clear colour lends no hue" });
});

test("color-mix mixes the colours as given and fits the result once; none is a missing component, drawn as 0", () => {
  near(parse("color-mix(in oklch, oklch(0.7 0.4 140), oklch(0.7 0 140))"), { is: parse("oklch(0.7 0.2 140)"), label: "half the given chroma, not half the fitted one" });
  near(parse("oklch(0.7 0.1 none)"), { is: parse("oklch(0.7 0.1 0)"), label: "a missing hue" });
  near(parse("oklab(0.7 none 0.05 / none)"), { is: parse("oklab(0.7 0 0.05 / 0)"), label: "a missing a and alpha" });
});

test("a malformed perceptual colour is an error, and the 2D context still parses the rest", () => {
  for (const bad of ["oklch(0.5 0.1)", "oklch(0.5 0.1 20 / 1 / 2)", "oklab(a b c)", "color-mix(in hsl, red, blue)", "color-mix(in oklab, red)"]) {
    assert.throws(() => parse(bad), (e: unknown) => e instanceof SketchUsageError && e.message.includes(`"${bad}" is not a CSS colour`), bad);
  }
  near(parse("teal"), { is: [0, 128 / 255, 128 / 255, 1], label: "a named colour" });
});
