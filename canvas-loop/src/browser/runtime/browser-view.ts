// The `draw` capability in the browser: a thin facade implementing the same
// `View` contract the CLI uses, delegating every paint call to the shared,
// context-generic Painter (one drawing implementation for both harnesses). It
// wraps a real DOM `CanvasRenderingContext2D`; `log` forwards to the runtime's
// transcript sink and `snapshot` is a no-op (the live canvas is always visible).
import type { SKRSContext2D } from "@napi-rs/canvas";
import { SketchUsageError } from "../../core/errors.js";
import type { Ctx2D } from "../../core/paint.js";
import { Painter } from "../../core/painter/engine.js";
import { PainterView } from "../../core/view.js";
import type { ControlBox, CursorKind, View } from "../../core/tea.js";
import { makeDomLayer } from "./layer.js";

export class BrowserView extends PainterView implements View {
  #canvas: HTMLCanvasElement;
  #log: (args: readonly unknown[]) => void;
  #names: ReadonlySet<string>;
  #placed = new Map<string, ControlBox>();

  constructor(deps: { ctx: CanvasRenderingContext2D; width: number; height: number; pixelRatio: number; log: (args: readonly unknown[]) => void; params: ReadonlySet<string> }) {
    const { log } = deps;
    // The DOM context satisfies the structural Ctx2D the Painter uses; only its
    // `fillStyle` union is wider (adds CanvasPattern, never set here), so one
    // boundary cast bridges what structural assignability can't express.
    super(
      new Painter({
        // eslint-disable-next-line no-restricted-syntax -- structural-context boundary: CanvasRenderingContext2D is a superset of Ctx2D (wider fillStyle union)
        ctx: deps.ctx as unknown as Ctx2D,
        width: deps.width,
        height: deps.height,
        makeLayer: (size) => makeDomLayer(deps.ctx.canvas.ownerDocument, size),
        pixelRatio: deps.pixelRatio,
        // No `warn`: faint-mark checks read pixels back, which stalls the GPU in a browser every frame.
        // Style problems (a call that can draw nothing) need no pixel reads; they go to the log.
        note: (message) => log([message]),
      }),
    );
    this.#log = log;
    this.#names = deps.params;
    this.#canvas = deps.ctx.canvas;
  }

  /** Record where param `name`'s input sits this frame; the figure places the real input there. */
  control(name: string, box: ControlBox): void {
    if (!this.#names.has(name)) throw new SketchUsageError({ detail: `control("${name}"): no param named "${name}" is declared` });
    this.#placed.set(name, { ...box });
  }

  /** This frame's control placements; clears them for the next draw. */
  takePlacements(): Map<string, ControlBox> {
    const placed = this.#placed;
    this.#placed = new Map();
    return placed;
  }

  get ctx(): SKRSContext2D {
    // The `View.ctx` escape hatch is typed against Skia's context; a sketch that
    // reaches for it uses only the shared 2D methods, present on both. It is the
    // Painter's active context, so raw drawing inside a group lands on the group.
    // eslint-disable-next-line no-restricted-syntax -- escape-hatch boundary: the DOM ctx stands in for SKRSContext2D; sketches touch only the shared subset
    return this.painter.ctx as unknown as SKRSContext2D;
  }

  cursor(kind: CursorKind): void {
    if (this.#canvas.style.cursor !== kind) this.#canvas.style.cursor = kind;
  }

  log(...args: readonly unknown[]): void {
    this.#log(args);
  }

  snapshot(_label?: string): void {
    // No-op: the browser canvas is continuously visible, so there is nothing to
    // capture. Kept to satisfy the View contract shared with the headless tier.
  }
}
