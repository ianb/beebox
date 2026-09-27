// canvas-loop headless runner (the "./headless" export): everything that renders
// a sketch without a browser — the @napi-rs/canvas-backed mutable `Sketch`, the
// deterministic frame/fold loops for both tiers, the events-script parsers, the
// recorder, and the transcript renderer. Depends on @napi-rs/canvas and node:
// builtins; import it only where those are available (the CLI, tests, tooling).
// The dependency-light authoring/drawing surface is the package root (".").

export { Sketch } from "../headless/sketch.js";
export type { SketchEventHandler, SketchModule } from "../headless/sketch.js";
export { run } from "../headless/runtime.js";
export type { RunOptions } from "../headless/runtime.js";
export type { RunResult } from "../headless/recorder/frame-recorder.js";
export { parseEvents, bucketByFrame, dispatchEvent } from "../headless/events.js";
export type { ScriptEvent, SnapshotDirective } from "../headless/events.js";
export type { RunMeta, TranscriptEntry } from "../headless/transcript.js";
export { renderTranscript } from "../headless/transcript.js";

// ── The Elm Architecture (TEA) tier ──────────────────────────────────
export { teaRun } from "../headless/tea-runtime.js";
export type { TeaRunOptions } from "../headless/tea-runtime.js";
export { isTeaModule, toTeaModule } from "../headless/tea-load.js";
export type { LoadedTeaModule } from "../headless/tea-load.js";
export { parseTeaEvents, bucketTeaByFrame } from "../headless/tea-events.js";
export type { TeaScriptEvent } from "../headless/tea-events.js";
export { TeaView, TeaUtil } from "../headless/tea-view.js";

// ── Gallery corpus check (`cli gallery check`) ────────────────────────
export { checkGallery } from "../headless/gallery.js";
export type { GalleryCheckEntry, GalleryCheckResult } from "../headless/gallery.js";
