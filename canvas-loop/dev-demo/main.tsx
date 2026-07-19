// The dev demo: two <SketchFigure> instances proving the ./react component
// embeds outside callback-box (this is a plain client page, no callback-box
// import anywhere in ./react). Bundled by dev-demo/build.ts into the tracked,
// self-contained dev/canvas-loop.html. Imports the component through its public
// package name — exactly how a consumer would.
//
//   • Orbit  — uncontrolled: state lives inside the figure. `onEvent` streams
//     the recorded input log to a live "last input" readout (watching).
//   • Fjord  — controlled + localStorage: the host owns the values, so
//     persistence is a few lines of composition here, not a component feature.
import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { SketchFigure } from "@ianbicking/canvas-loop/react";
import type { ParamRecord } from "@ianbicking/canvas-loop/react";
import type { TeaScriptEvent } from "../src/headless/tea-events.js";
import { asPlaygroundModule } from "../browser/sketch-types.js";
import * as orbit from "../examples/orbit-tea.js";
import * as fjord from "../examples/fjord-tea.js";

const orbitModule = asPlaygroundModule(orbit);
const fjordModule = asPlaygroundModule(fjord);

const FJORD_KEY = "canvas-loop-demo:fjord-params";
const FJORD_DEFAULTS: ParamRecord = { tide: 0, timeOfDay: "day" };

// Read the persisted fjord params, field by field, with no cast — an unknown
// parse result is validated against the two known fields and otherwise ignored.
function loadFjordParams(): ParamRecord {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(FJORD_KEY);
  } catch (_e) {
    return FJORD_DEFAULTS;
  }
  if (raw === null) return FJORD_DEFAULTS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (_e) {
    return FJORD_DEFAULTS;
  }
  if (typeof parsed !== "object" || parsed === null) return FJORD_DEFAULTS;
  const tide = "tide" in parsed ? parsed.tide : undefined;
  const timeOfDay = "timeOfDay" in parsed ? parsed.timeOfDay : undefined;
  return {
    tide: typeof tide === "number" ? tide : FJORD_DEFAULTS["tide"] ?? 0,
    timeOfDay: typeof timeOfDay === "string" ? timeOfDay : FJORD_DEFAULTS["timeOfDay"] ?? "day",
  };
}

function saveFjordParams(values: ParamRecord): void {
  try {
    window.localStorage.setItem(FJORD_KEY, JSON.stringify(values));
  } catch (_e) {
    // Storage may be unavailable (private mode / quota); the figure still works.
  }
}

function OrbitDemo(): JSX.Element {
  const [lastInput, setLastInput] = useState("none yet");
  const handleEvent = useCallback((entry: TeaScriptEvent): void => {
    setLastInput(`frame ${entry.frame}: ${entry.type}`);
  }, []);
  return (
    <section className="demo-card">
      <h2>Orbit — uncontrolled + recorder</h2>
      <p className="demo-note">
        State lives inside the figure; <code>initialParams</code> overrides a default. The recorder panel and the{" "}
        <strong>last input</strong> readout below are fed by <code>onEvent</code> (watching).
      </p>
      <SketchFigure module={orbitModule} initialParams={{ "speed-scale": 1.5 }} showRecorder onEvent={handleEvent} />
      <p className="demo-watch">
        last input: <code>{lastInput}</code>
      </p>
    </section>
  );
}

function FjordDemo(): JSX.Element {
  const [params, setParams] = useState<ParamRecord>(loadFjordParams);
  const handleParamsChange = useCallback((values: ParamRecord): void => {
    setParams(values);
    saveFjordParams(values);
  }, []);
  const handleClear = useCallback((): void => {
    try {
      window.localStorage.removeItem(FJORD_KEY);
    } catch (_e) {
      // Ignore storage errors — resetting the in-memory params is enough.
    }
    setParams(FJORD_DEFAULTS);
  }, []);
  return (
    <section className="demo-card">
      <h2>Fjord — controlled + localStorage persistence</h2>
      <p className="demo-note">
        The host owns the values (<code>params</code> + <code>onParamsChange</code>), so persistence is composition:
        each change is written to <code>localStorage</code> and restored on reload. Host-injected changes dispatch
        through the normal param message path.
      </p>
      <SketchFigure module={fjordModule} params={params} onParamsChange={handleParamsChange} />
      <p className="demo-note">
        <button type="button" className="demo-link" onClick={handleClear}>
          clear saved state
        </button>
      </p>
    </section>
  );
}

function App(): JSX.Element {
  return (
    <main className="demo">
      <header className="demo-header">
        <h1>canvas-loop · &lt;SketchFigure&gt;</h1>
        <p className="demo-note">
          The <code>@ianbicking/canvas-loop/react</code> component embedding two TEA sketches — no callback-box in
          sight. Drag on a canvas, move the sliders, reload the page.
        </p>
      </header>
      <OrbitDemo />
      <FjordDemo />
    </main>
  );
}

const host = document.getElementById("app");
if (host !== null) createRoot(host).render(<App />);
