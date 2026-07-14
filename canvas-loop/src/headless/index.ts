// canvas-loop headless runner (the "./headless" export): everything that renders
// a sketch without a browser — the @napi-rs/canvas-backed mutable `Sketch`, the
// deterministic frame/fold loops for both tiers, the events-script parsers, the
// recorder, and the transcript renderer. Depends on @napi-rs/canvas and node:
// builtins; import it only where those are available (the CLI, tests, tooling).
// The dependency-light authoring/drawing surface is the package root (".").

export { Sketch } from "./sketch.js";
export type { SketchEventHandler, SketchModule } from "./sketch.js";
export { run } from "./runtime.js";
export type { RunOptions } from "./runtime.js";
export type { RunResult } from "./recorder.js";
export { parseEvents, bucketByFrame, dispatchEvent } from "./events.js";
export type { ScriptEvent, SnapshotDirective } from "./events.js";
export type { RunMeta, TranscriptEntry } from "./transcript.js";
export { renderTranscript } from "./transcript.js";

// ── The Elm Architecture (TEA) tier ──────────────────────────────────
export { teaRun } from "./tea-runtime.js";
export type { LoadedTeaModule, TeaRunOptions } from "./tea-runtime.js";
export { isTeaModule, toTeaModule } from "./tea-load.js";
export { parseTeaEvents, bucketTeaByFrame } from "./tea-events.js";
export type { TeaScriptEvent } from "./tea-events.js";
export { TeaView, TeaUtil } from "./tea-view.js";

// ── Gallery corpus check (`cli gallery check`) ────────────────────────
export { checkGallery } from "./gallery.js";
export type { GalleryCheckEntry, GalleryCheckResult } from "./gallery.js";
