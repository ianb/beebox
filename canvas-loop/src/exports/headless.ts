// canvas-loop headless runner (the "./headless" export): everything that renders
// a sketch without a browser — the deterministic fold loop over the scene
// surface (the recorder and the GPU renderer on Dawn), the events-script
// parser, the frame recorder, and the transcript renderer. Depends on
// @napi-rs/canvas (PNG, text measuring), `webgpu`
// and node: builtins; import it only where those are available (the CLI,
// tests, tooling).
// The dependency-light authoring/drawing surface is the package root (".").

export type { RunResult } from "../headless/recorder/frame-recorder.js";
export type { RunMeta, TranscriptEntry } from "../headless/transcript.js";
export { renderTranscript } from "../headless/transcript.js";

// ── TEA runs ─────────────────────────────────────────────────────────
export { teaRun } from "../headless/tea-runtime/runner.js";
export type { TeaRunOptions } from "../headless/tea-runtime/runner.js";
export { toTeaModule } from "../headless/tea-load.js";
export type { LoadedTeaModule } from "../headless/tea-load.js";
export { parseTeaEvents, bucketTeaByFrame } from "../headless/tea-events.js";
export type { TeaScriptEvent } from "../headless/tea-events.js";
export { TeaUtil } from "../headless/tea-util.js";
export type { UtilText } from "../headless/tea-util.js";
export { NoGpuAdapterError } from "../scene/errors.js";

// ── Gallery corpus check (`cli gallery check`) ────────────────────────
export { checkGallery } from "../headless/gallery.js";
export type { GalleryCheckEntry, GalleryCheckResult } from "../headless/gallery.js";

// ── Experimental: frame diff views (`cli diff`) ───────────────────────
export { statsLine, writeDiff } from "../headless/diff.js";
export type { DiffStats } from "../headless/diff.js";

// ── Development checkpoints (CANVAS_LOOP_CHECKPOINTS, `cli checkpoints`) ──
export { CHECKPOINT_ENV, saveCheckpoint } from "../headless/checkpoint/save.js";
export type { CheckpointMeta } from "../headless/checkpoint/save.js";
export { checkpointPage, lineChanges } from "../headless/checkpoint/page.js";
