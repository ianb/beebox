// Errors raised by the scene recorder and GPU renderer. Misuse of the API stays `SketchUsageError`
// (core/errors.ts); these name what they do not do yet, or a GPU fault.
import { SketchUsageError } from "../core/errors.js";

/** A draft 2.2 call or option the scene recorder or renderer does not support yet. */
export class UnsupportedCallError extends Error {
  name = "UnsupportedCallError";
  readonly call: string;
  constructor(options: { call: string; detail?: string }) {
    super(`${options.call} is not supported yet${options.detail === undefined ? "" : ` (${options.detail})`}`);
    this.call = options.call;
  }
}

/** A View member today's API had and the scene API removed: `call` names it, `replacement` what to use instead. */
export class RemovedCallError extends SketchUsageError {
  name = "RemovedCallError";
  readonly call: string;
  readonly replacement: string;
  constructor(options: { call: string; replacement: string }) {
    super({ detail: `${options.call} was removed: ${options.replacement}` });
    this.call = options.call;
    this.replacement = options.replacement;
  }
}

/**
 * The GPU rejected work, or the scene does not fit the renderer's limits.
 * `path` names the node that was being lowered (`group "room" > place picture
 * "citizen" > circle #4`), when the error came from one.
 */
export class GpuRenderError extends Error {
  name = "GpuRenderError";
  readonly path: string | undefined;
  constructor(options: { detail: string; path?: string; cause?: unknown }) {
    super(`GPU renderer: ${options.detail}${options.path === undefined ? "" : ` (at ${options.path})`}`, options.cause === undefined ? undefined : { cause: options.cause });
    this.path = options.path;
  }
}

/**
 * Headless: Dawn found no GPU adapter, so the scene renderer cannot draw. The
 * run wrote its transcript first (the header and the failure line), at
 * `transcriptPath`. A caller catches this by class; it is never in
 * `RunResult.errors`.
 */
export class NoGpuAdapterError extends Error {
  name = "NoGpuAdapterError";
  readonly transcriptPath: string;
  constructor(options: { transcriptPath: string }) {
    super(
      "no GPU adapter: Dawn (WebGPU for Node) found none, so the scene renderer cannot draw. Possible causes: no Vulkan driver is installed (on Linux, Mesa's lavapipe is a software one); a driver is installed but this user cannot open it; a sandbox hides the GPU",
    );
    this.transcriptPath = options.transcriptPath;
  }
}

/** A scene figure cannot mount in this browser (no WebGPU, no adapter) or was handed a bad module. */
export class SceneMountError extends Error {
  name = "SceneMountError";
  constructor(options: { detail: string }) {
    super(`mountSceneSketch: ${options.detail}`);
  }
}

/** `Name: message`, with a hint for a change to the frozen model (a TypeError from the engine names only the property). */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const frozen = error instanceof TypeError && /read only property|not extensible|Cannot add property|Cannot delete property/.test(error.message);
  return `${error.name}: ${error.message}${frozen ? " (the model is frozen: update returns a new model, and draw only reads it)" : ""}`;
}

/** A sketch's `init`, `update` or `draw`, or the frame's render, threw: the frame, the step and the sketch's line; `cause` is the original error. */
export class SketchRunError extends Error {
  name = "SketchRunError";
  constructor(options: { frame: number | undefined; step: string; error: unknown; at: string | undefined }) {
    const { frame, step, error, at } = options;
    const what = describeError(error);
    super(`${frame === undefined ? step : `frame ${frame}, ${step}`}: ${what}${at === undefined ? "" : ` (at ${at})`}`, { cause: error });
  }
}
