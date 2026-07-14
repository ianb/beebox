// <SketchFigure> — the browser TEA runner as a React component. This file is
// mounting + prop plumbing + lifecycle ONLY; the runtime, view, util, and the
// declaration-generated controls are the single browser implementation, imported
// from ../../browser. SSR-safe by construction: no window/document/canvas is
// touched at module scope or during render. `useSyncExternalStore` reports
// client-vs-server so the server (and the first hydration pass) renders a plain
// placeholder div; the runtime is created in an effect, only on the client.
//
// Params are initializable / watchable / persistable, optionally:
//   • Uncontrolled — `initialParams` overrides declaration defaults; state lives
//     inside; `onParamsChange` reports each applied change (for host persistence).
//   • Controlled — `params` + `onParamsChange`: the host owns the values.
//     Host-injected changes dispatch through the normal `param` msg path (the
//     params effect calls `runtime.setParam`), never by poking model state.
//   • `onEvent` streams every recorded `{frame, type, …}` entry — watching
//     generalizes past params, since every input is already a logged msg.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { JSX } from "react";
import type { TeaScriptEvent } from "../headless/tea-events.js";
import type { PlaygroundModule } from "../../browser/sketch-types.js";
import { Runtime } from "../../browser/runtime.js";
import { ParamControls } from "./ParamControls.js";
import { RecorderPanel } from "./RecorderPanel.js";
import type { ParamRecord } from "./figure-internals.js";
import { DEFAULT_CANVAS, SKETCH_FIGURE_CSS, displaySize, resolveValues, wireInput } from "./figure-internals.js";

export type { ParamRecord } from "./figure-internals.js";

export interface SketchFigureProps {
  /** The TEA sketch module to run (its `init`/`update`/`draw`, `params`, `canvas`). */
  module: PlaygroundModule;
  /** PRNG seed; changing it re-runs the sketch from frame 0. Default 42. */
  seed?: number;
  /** Start the rAF loop immediately. Default true; false renders a paused frame 0. */
  autoplay?: boolean;
  /** Show the generated param panel (+ a play/pause + restart toolbar). Default true. */
  showControls?: boolean;
  /** Show the live recorded-events viewer. Default false. */
  showRecorder?: boolean;
  /** Display height in CSS px; the canvas scales to fit (aspect preserved). */
  height?: number;
  /** Display scale multiplier over the intrinsic canvas size (wins over `height`). */
  scale?: number;
  /** UNCONTROLLED: partial overrides of declaration defaults for the initial run. */
  initialParams?: ParamRecord;
  /** CONTROLLED: the host-owned param values. Changes dispatch through the msg path. */
  params?: ParamRecord;
  /** Reports the applied param values after a change (host persistence hook). */
  onParamsChange?: (values: ParamRecord) => void;
  /** Streams each recorded input entry as it is dispatched (the events-file line). */
  onEvent?: (entry: TeaScriptEvent) => void;
}

const DEFAULT_SEED = 42;

interface LatestProps {
  controlled: boolean;
  params: ParamRecord | undefined;
  initialParams: ParamRecord | undefined;
  playing: boolean;
  seed: number;
  onEvent: ((entry: TeaScriptEvent) => void) | undefined;
  onParamsChange: ((values: ParamRecord) => void) | undefined;
}

// A no-op external store whose server snapshot is false and client snapshot true
// — the sanctioned React way to branch on "am I hydrated yet" without a
// set-state-in-effect. Module-scope constants keep the store reference stable.
const subscribeNoop = (): (() => void) => () => {};
const clientSnapshot = (): boolean => true;
const serverSnapshot = (): boolean => false;

export function SketchFigure(props: SketchFigureProps): JSX.Element {
  const isClient = useSyncExternalStore(subscribeNoop, clientSnapshot, serverSnapshot);
  const controlled = props.params !== undefined;
  const decl = props.module.params ?? {};
  const canvas = props.module.canvas ?? DEFAULT_CANVAS;
  const seed = props.seed ?? DEFAULT_SEED;
  const autoplay = props.autoplay ?? true;
  const showControls = props.showControls ?? true;
  const showRecorder = props.showRecorder ?? false;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const dispatchedRef = useRef<ParamRecord>({});
  const latestRef = useRef<LatestProps | null>(null);

  const [playing, setPlaying] = useState(autoplay);
  const [frame, setFrame] = useState(0);
  const [eventCount, setEventCount] = useState(0);
  const [eventsJson, setEventsJson] = useState("[]");
  const [ownValues, setOwnValues] = useState<ParamRecord>(() => resolveValues({ decl, overrides: props.initialParams }));

  // Keep the latest props reachable from the runtime callbacks and the creation
  // effect without making them effect deps (which would recreate the runtime on
  // every param edit). Updated after every commit, before the effects below run.
  useEffect(() => {
    latestRef.current = {
      controlled,
      params: props.params,
      initialParams: props.initialParams,
      playing,
      seed,
      onEvent: props.onEvent,
      onParamsChange: props.onParamsChange,
    };
  });

  // Create the runtime on the client whenever the sketch identity changes
  // (module / seed / size), and on first hydration (isClient flips true). Full
  // teardown on cleanup: stop the rAF, remove listeners, drop the ref.
  useEffect(() => {
    if (!isClient) return;
    const el = canvasRef.current;
    if (el === null) return;
    const ctx = el.getContext("2d");
    if (ctx === null) return;
    const latest = latestRef.current;
    const initialParams = latest === null ? undefined : latest.controlled ? latest.params : latest.initialParams;
    const runtime = new Runtime({
      module: props.module,
      ctx,
      width: canvas.width,
      height: canvas.height,
      seed,
      // Omit rather than pass `undefined` — RuntimeDeps is exactOptionalPropertyTypes.
      ...(initialParams !== undefined ? { initialParams } : {}),
      onFrame: (f) => setFrame(f),
      onLog: () => {
        // The figure surfaces frames + recorded events, not the transcript log.
      },
      onEvent: (entry) => {
        const now = latestRef.current;
        now?.onEvent?.(entry);
        const rt = runtimeRef.current;
        if (rt === null) return;
        setEventCount(rt.eventCount());
        setEventsJson(rt.eventsJSON());
        if (entry.type === "param" && now !== null && !now.controlled) {
          const values = rt.paramValues();
          setOwnValues(values);
          now.onParamsChange?.(values);
        }
      },
    });
    runtimeRef.current = runtime;
    dispatchedRef.current = { ...runtime.paramValues() };
    runtime.setPaused(!(latest?.playing ?? autoplay));
    runtime.start();
    const detach = wireInput(el, runtime);
    return () => {
      detach();
      runtime.stop();
      runtimeRef.current = null;
    };
  }, [props.module, seed, canvas.width, canvas.height, autoplay, isClient]);

  // Toggle the existing runtime's paused state when the user hits play/pause —
  // pausing freezes the frame and state rather than tearing the runtime down.
  useEffect(() => {
    runtimeRef.current?.setPaused(!playing);
  }, [playing]);

  // CONTROLLED: dispatch host-injected value changes through the msg path. Diff
  // against what was last dispatched so an unchanged prop doesn't re-fire.
  useEffect(() => {
    if (props.params === undefined) return;
    const rt = runtimeRef.current;
    if (rt === null) return;
    const prev = dispatchedRef.current;
    for (const [name, value] of Object.entries(props.params)) {
      if (prev[name] !== value) rt.setParam(name, value);
    }
    dispatchedRef.current = { ...props.params };
  }, [props.params]);

  const handleParam = useCallback((name: string, value: number | boolean | string): void => {
    const latest = latestRef.current;
    if (latest !== null && latest.controlled) {
      // Host owns the values: report the change; the params effect dispatches it.
      latest.onParamsChange?.({ ...(latest.params ?? {}), [name]: value });
    } else {
      // Uncontrolled: dispatch now; state + onParamsChange follow from the echo.
      runtimeRef.current?.setParam(name, value);
    }
  }, []);

  const handleTrigger = useCallback((name: string): void => {
    runtimeRef.current?.trigger(name);
  }, []);

  const togglePlay = useCallback((): void => setPlaying((p) => !p), []);

  const restart = useCallback((): void => {
    const rt = runtimeRef.current;
    if (rt === null) return;
    rt.restart(latestRef.current?.seed ?? DEFAULT_SEED);
    dispatchedRef.current = { ...rt.paramValues() };
    setEventCount(0);
    setEventsJson("[]");
  }, []);

  const display = displaySize({ canvas, scale: props.scale, height: props.height });

  if (!isClient) {
    return (
      <div className="cl-figure">
        <style>{SKETCH_FIGURE_CSS}</style>
        <div className="cl-placeholder" style={{ width: display.width, height: display.height }} aria-busy="true" />
      </div>
    );
  }

  const values = controlled ? resolveValues({ decl, overrides: props.params }) : ownValues;

  return (
    <div className="cl-figure">
      <style>{SKETCH_FIGURE_CSS}</style>
      <canvas
        ref={canvasRef}
        width={canvas.width}
        height={canvas.height}
        className="cl-canvas"
        tabIndex={0}
        style={{ width: display.width, height: display.height }}
      />
      {showControls ? (
        <div className="cl-toolbar">
          <span className="cl-frame">frame {frame}</span>
          <button type="button" className="cl-btn" onClick={togglePlay}>
            {playing ? "Pause" : "Play"}
          </button>
          <button type="button" className="cl-btn" onClick={restart}>
            Restart
          </button>
        </div>
      ) : null}
      {showControls ? <ParamControls decl={decl} values={values} onParam={handleParam} onTrigger={handleTrigger} /> : null}
      {showRecorder ? <RecorderPanel json={eventsJson} count={eventCount} /> : null}
    </div>
  );
}
