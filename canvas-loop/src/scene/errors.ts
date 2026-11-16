// Errors raised by the scene recorder and GPU renderer. Misuse of the API stays `SketchUsageError`
// (core/errors.ts); these name what they do not do yet, or a GPU fault.
import { SketchUsageError } from "../core/errors.js";

/**
 * A draft 2.2 call or option the scene recorder or renderer does not support
 * yet. `at` is the node path, when a check after `draw` (the resolve walk)
 * found it.
 */
export class UnsupportedCallError extends Error {
  name = "UnsupportedCallError";
  readonly call: string;
  readonly detail: string | undefined;
  constructor(options: { call: string; detail?: string; at?: string }) {
    super(`${options.call} is not supported yet${options.detail === undefined ? "" : ` (${options.detail})`}${options.at === undefined ? "" : ` in ${options.at}`}`);
    this.call = options.call;
    this.detail = options.detail;
  }
}

const PICTURES = "use v.picture({ key, width, height, deps }, body) and v.place(picture, x, y) (TEA.md, \"Pictures\")";

/** Each removed View member and what replaces it: the recorder's `RemovedCallError` and the sketch type check both say it. */
export const REPLACEMENTS = {
  "v.ctx": "draw with the View's calls; a transform with at({ matrix }) or at({ skew }), pixel fields with v.pixels, hand-built lighting with group({ lighting }) (TEA.md, \"Pictures\"; BRUSHES.md, \"Lighting\")",
  "v.cache": PICTURES,
  "v.sprite": PICTURES,
  "v.image": PICTURES,
  "v.paperTexture": "use group({ effects: { paper: amount } }, children), an effect scoped to the group (BRUSHES.md, \"Paper\")",
} as const;

/** A `draw` that makes drawing calls as statements and returns nothing: the recorder's `RemovedCallError` and the sketch type check both say it. */
export const STATEMENT_DRAW = {
  call: "drawing calls as statements",
  replacement: "return the drawing from draw: return [v.rect(…), v.at(options, [children])] (a node, a list, or null for nothing)",
} as const;

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
 * No GPU adapter, so the scene renderer cannot draw. Headless (Dawn), the run
 * wrote its transcript first (the header and the failure line), at
 * `transcriptPath`; in a browser figure `transcriptPath` is undefined and the
 * error reaches `onError`. A caller catches this by class; it is never in
 * `RunResult.errors`.
 */
export class NoGpuAdapterError extends Error {
  name = "NoGpuAdapterError";
  readonly transcriptPath: string | undefined;
  constructor(options: { transcriptPath: string } | { browser: true }) {
    super(
      "transcriptPath" in options
        ? "no GPU adapter: Dawn (WebGPU for Node) found none, so the scene renderer cannot draw. Possible causes: no Vulkan driver is installed (on Linux, Mesa's lavapipe is a software one); a driver is installed but this user cannot open it; a sandbox hides the GPU"
        : "no GPU adapter: the browser has WebGPU but gave no adapter, so the figure cannot draw. Possible causes: the GPU is blocked for this browser or site, or unavailable",
    );
    this.transcriptPath = "transcriptPath" in options ? options.transcriptPath : undefined;
  }
}

/** A browser figure cannot draw: the browser has no WebGPU (`navigator.gpu`), and there is no Canvas2D fallback. */
export class NoWebGpuError extends Error {
  name = "NoWebGpuError";
  constructor() {
    super("no WebGPU: this browser has no navigator.gpu, so the figure cannot draw (canvas-loop figures need WebGPU)");
  }
}

/** `mountSketch` or `attachSketch` cannot mount: a bad module value, or a canvas that gives no WebGPU context. */
export class SketchMountError extends Error {
  name = "SketchMountError";
  constructor(options: { detail: string }) {
    super(`mountSketch: ${options.detail}`);
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
