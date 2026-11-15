// Errors raised by the scene spike. Misuse of the API stays `SketchUsageError`
// (core/errors.ts); these name what the spike does not do yet, or a GPU fault.

/** A draft 2.2 call or option the spike recorder or renderer does not support yet. */
export class UnsupportedCallError extends Error {
  name = "UnsupportedCallError";
  readonly call: string;
  constructor(options: { call: string; detail?: string }) {
    super(`scene spike: ${options.call} is not supported yet${options.detail === undefined ? "" : ` (${options.detail})`}`);
    this.call = options.call;
  }
}

/** The GPU rejected work, or the scene does not fit the renderer's limits. */
export class GpuRenderError extends Error {
  name = "GpuRenderError";
  constructor(options: { detail: string }) {
    super(`GPU renderer: ${options.detail}`);
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
