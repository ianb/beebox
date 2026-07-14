export { Sketch } from "./sketch.js";
export { run } from "./runtime.js";
export type { RunOptions } from "./runtime.js";
export type { RunResult } from "./recorder.js";
export { parseEvents, bucketByFrame, dispatchEvent } from "./events.js";
export type { RunMeta, TranscriptEntry } from "./transcript.js";
export { renderTranscript } from "./transcript.js";
export type {
  EventType,
  LogLevel,
  SketchEvent,
  SketchEventHandler,
  SketchInputEvent,
  SketchModule,
} from "./types.js";

// ── The Elm Architecture (TEA) tier ──────────────────────────────────
export { teaRun } from "./tea-runtime.js";
export type { LoadedTeaModule, TeaRunOptions } from "./tea-runtime.js";
export { isTeaModule, toTeaModule } from "./tea-load.js";
export { parseTeaEvents, bucketTeaByFrame } from "./tea-events.js";
export type { TeaScriptEvent } from "./tea-events.js";
export { TeaView, TeaUtil } from "./tea-view.js";
export type {
  BooleanParam,
  CanvasSize,
  ClipShape,
  ColorStop,
  DeepReadonly,
  Gradient,
  LinearGradient,
  Msg,
  NumberParam,
  Paint,
  ParamDecl,
  ParamsDecl,
  ParamValues,
  PathCommand,
  RadialGradient,
  SelectParam,
  TeaModule,
  TextAlign,
  TextBaseline,
  TriggerParam,
  Util,
  Vec2,
  View,
} from "./tea.js";
