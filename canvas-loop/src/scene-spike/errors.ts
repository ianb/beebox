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
