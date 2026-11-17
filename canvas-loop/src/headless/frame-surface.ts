// The seam a headless run draws through, implemented by the scene surface
// (headless/scene/surface.ts): what the runner asks of a frame.
import type { Scene } from "../scene/nodes.js";
import type { Pixels } from "./recorder/capture.js";
import type { UtilText } from "./tea-util.js";

/** One captured frame: its pixels (unpremultiplied RGBA) and what the transcript shows under its image. */
export interface Capture {
  readonly pixels: Pixels;
  /** Log lines after the image (`--timing`'s per-frame counts). */
  readonly lines: readonly string[];
  /** The frame's scene outline (`--scene`), or undefined. */
  readonly block: string | undefined;
}

export interface FrameSurface {
  /** Text measured as `draw` lays it out, for the run's `Util`. */
  readonly text: UtilText;
  /** The GPU adapter, for the transcript header. */
  readonly adapter: string | undefined;
  /** Run one frame's `draw` against this surface's View; its logs, warnings and snapshots go to the host. Synchronous. */
  draw(paint: (v: unknown) => unknown): void;
  /** The scene the last `draw` recorded, which pointer messages are hit-tested against; undefined before the first. */
  hitScene(): Scene | undefined;
  /** The last drawn frame, rendered. */
  capture(): Promise<Capture>;
  /** After the last frame: end-of-run warnings go to the host. */
  finish(): void;
  /** Free what the surface holds. */
  close(): void;
}
