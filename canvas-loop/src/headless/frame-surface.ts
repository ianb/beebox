// The seam a headless run draws through. During the move to the scene
// renderer two surfaces implement it: today's Canvas2D one (here) and the
// scene one (headless/scene/surface.ts). The sketch module's `renderer`
// export picks between them; the Canvas2D one goes when the painter does.
import type { ParamsDecl, ParamValues } from "../core/tea.js";
import type { SketchHost } from "../core/types.js";
import type { Pixels } from "./recorder/capture.js";
import { Surface } from "./surface.js";
import { TeaView } from "./tea-view.js";
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
  /** The GPU adapter, for the transcript header; undefined for the Canvas2D surface. */
  readonly adapter: string | undefined;
  /** Run one frame's `draw` against this surface's View; its logs, warnings and snapshots go to the host. Synchronous. */
  draw(paint: (v: unknown) => void): void;
  /** The last drawn frame, rendered. */
  capture(): Promise<Capture>;
  /** After the last frame: end-of-run warnings go to the host. */
  finish(): void;
  /** Free what the surface holds. */
  close(): void;
}

/** Today's surface: the Painter over a @napi-rs/canvas canvas, read back as drawn. */
export class CanvasFrameSurface implements FrameSurface {
  readonly #surface: Surface;
  readonly #view: TeaView;
  readonly text: UtilText;
  readonly adapter = undefined;

  constructor(options: { width: number; height: number; host: SketchHost; outline: boolean; decl: ParamsDecl; getParams: () => ParamValues<ParamsDecl> }) {
    const { width, height, host, outline } = options;
    this.#surface = new Surface({ width, height, host, outline });
    this.#view = new TeaView({ surface: this.#surface, decl: options.decl, getParams: options.getParams });
    const painter = this.#surface.painter;
    this.text = { width: (content, opts) => painter.textWidth(content, opts), bounds: (...args) => painter.plainTextBounds(...args) };
  }

  draw(paint: (v: unknown) => void): void {
    paint(this.#view);
    // The `--outline` overlay, over the finished frame.
    this.#surface.finishFrame();
  }

  capture(): Promise<Capture> {
    return Promise.resolve({ pixels: this.#surface.readPixels(), lines: [], block: undefined });
  }

  finish(): void {}

  close(): void {}
}
