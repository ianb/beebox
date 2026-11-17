// The dev demo: two <SketchFigure> instances proving the ./react component
// embeds outside beebox (this is a plain client page, no beebox
// import anywhere in ./react). Bundled by src/dev-demo/build.ts into the tracked,
// self-contained dev/canvas-loop.html. Imports the component through its public
// package name — exactly how a consumer would.
//
//   • Orbit  — uncontrolled: state lives inside the figure. `onEvent` streams
//     the recorded input log to a live "last input" readout (watching).
//   • Brushes — controlled + localStorage: the host owns the values, so
//     persistence is a few lines of composition here, not a component feature.
import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { SketchFigure } from "@ianbicking/canvas-loop/react";
import type { ParamRecord } from "@ianbicking/canvas-loop/react";
import type { TeaScriptEvent } from "../headless/tea-events.js";
import { asPlaygroundModule } from "../browser/sketch-types.js";
import * as orbit from "../examples/orbit-tea.js";
import * as brushes from "../examples/brushes-tea.js";

const orbitModule = asPlaygroundModule(orbit);
const brushesModule = asPlaygroundModule(brushes);

const BRUSHES_KEY = "canvas-loop-demo:brushes-params";

// Read the persisted brushes params. Each stored field is kept only when the
// brushes declaration accepts it; anything else falls back to the default.
function loadBrushesParams(): ParamRecord {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(BRUSHES_KEY);
  } catch (_e) {
    return {};
  }
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (_e) {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const stored = new Map(Object.entries(parsed));
  const accepted = Object.entries(brushes.params).flatMap(([name, decl]): [string, string | number][] => {
    const value = stored.get(name);
    if (decl.type === "select" && typeof value === "string" && new Set<string>(decl.options).has(value)) return [[name, value]];
    if (decl.type === "number" && typeof value === "number" && value >= decl.min && value <= decl.max) return [[name, value]];
    return [];
  });
  return Object.fromEntries(accepted);
}

function saveBrushesParams(values: ParamRecord): void {
  try {
    window.localStorage.setItem(BRUSHES_KEY, JSON.stringify(values));
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

function BrushesDemo(): JSX.Element {
  const [params, setParams] = useState<ParamRecord>(loadBrushesParams);
  const handleParamsChange = useCallback((values: ParamRecord): void => {
    setParams(values);
    saveBrushesParams(values);
  }, []);
  const handleClear = useCallback((): void => {
    try {
      window.localStorage.removeItem(BRUSHES_KEY);
    } catch (_e) {
      // Ignore storage errors — resetting the in-memory params is enough.
    }
    setParams({});
  }, []);
  return (
    <section className="demo-card">
      <h2>Brushes — controlled + localStorage persistence</h2>
      <p className="demo-note">
        The host owns the values (<code>params</code> + <code>onParamsChange</code>), so persistence is composition:
        each change is written to <code>localStorage</code> and restored on reload. Host-injected changes dispatch
        through the normal param message path.
      </p>
      <SketchFigure module={brushesModule} params={params} onParamsChange={handleParamsChange} />
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
          The <code>@ianbicking/canvas-loop/react</code> component embedding two TEA sketches — no beebox in
          sight. Drag on a canvas, move the sliders, reload the page.
        </p>
      </header>
      <OrbitDemo />
      <BrushesDemo />
    </main>
  );
}

const host = document.getElementById("app");
if (host !== null) createRoot(host).render(<App />);
