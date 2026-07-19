import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
// The `./react` subpath, imported by its public package name — proving the
// export resolves for a consumer and that a server render never touches a
// canvas. JSX is avoided here (plain `createElement`) so the test runs under
// tsx regardless of the ambient jsx runtime config.
import { SketchFigure } from "@ianbicking/canvas-loop/react";
import { asPlaygroundModule } from "../browser/sketch-types.js";
import * as orbit from "../examples/orbit-tea.js";
import * as fjord from "../examples/fjord-tea.js";
import { controlModels } from "../browser/controls-model.js";
import { resolveValues } from "../src/react/figure-internals.js";

const orbitModule = asPlaygroundModule(orbit);
const fjordModule = asPlaygroundModule(fjord);

// If any of window/document/HTMLCanvasElement is defined, the render below could
// silently pass by using a real DOM. Assert the bare Node test env has none, so
// "did not throw" genuinely means "did not need a canvas".
test("the test environment has no DOM (server-only render is a real test)", () => {
  assert.equal(typeof globalThis.document, "undefined", "no document in the test env");
  assert.equal(typeof globalThis.window, "undefined", "no window in the test env");
  assert.equal("HTMLCanvasElement" in globalThis, false, "no canvas constructor in the test env");
});

test("renderToString(<SketchFigure/>) does not throw and does not render a canvas", () => {
  let html = "";
  assert.doesNotThrow(() => {
    html = renderToString(createElement(SketchFigure, { module: orbitModule }));
  }, "server render must not touch window/document/canvas");
  assert.match(html, /cl-placeholder/, "server render emits the placeholder div");
  assert.doesNotMatch(html, /<canvas/, "server render must not emit a canvas element");
});

test("renderToString is safe with controls, recorder, and controlled params enabled", () => {
  assert.doesNotThrow(() => {
    renderToString(
      createElement(SketchFigure, {
        module: fjordModule,
        showControls: true,
        showRecorder: true,
        params: { tide: 0.5, timeOfDay: "dusk" },
        onParamsChange: () => {},
        onEvent: () => {},
      }),
    );
  }, "every prop path must be SSR-safe");
});

// Prop-plumbing without a DOM: the controlled/uncontrolled value resolution and
// the declaration → control mapping are pure, so they are exercised directly.
// Full controlled dispatch (host change → runtime.setParam → param event) needs
// the browser and is exercised on the dev demo page (dev/canvas-loop.html).
test("controlled params override declaration defaults in the rendered controls", () => {
  const decl = fjordModule.params ?? {};
  const values = resolveValues({ decl, overrides: { tide: 0.5, timeOfDay: "dusk" } });
  assert.equal(values["tide"], 0.5, "the host-supplied value wins over the default");
  assert.equal(values["timeOfDay"], "dusk", "the host-supplied select value wins over the default");
});

test("uncontrolled initialParams override declaration defaults", () => {
  const decl = orbitModule.params ?? {};
  // orbit declares speed-scale default 1; override it.
  const values = resolveValues({ decl, overrides: { "speed-scale": 2.5 } });
  assert.equal(values["speed-scale"], 2.5, "initialParams override the declared default");
  assert.equal(values["focus"], "Mercury", "un-overridden params keep their declared default");
});

test("controlModels resolves the declaration into typed control descriptors", () => {
  const decl = orbitModule.params ?? {};
  const values = resolveValues({ decl, overrides: undefined });
  const models = controlModels({ decl, values });
  const byName = new Map(models.map((m) => [m.name, m]));
  assert.equal(byName.get("speed-scale")?.kind, "number", "a number param yields a number control");
  assert.equal(byName.get("show-orbits")?.kind, "boolean", "a boolean param yields a checkbox control");
  assert.equal(byName.get("focus")?.kind, "select", "a select param yields a select control");
  assert.equal(byName.get("reset")?.kind, "trigger", "a trigger param yields a button control");
});
