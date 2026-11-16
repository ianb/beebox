// Testing mode's checks over what the recorder records, made together when a
// recorder audits: drawings off the canvas (off-canvas.ts), text checks
// (text-checks.ts), and the call site of each brushed mark the renderer may
// find too faint to see (its readback happens after the frame's render).
import type { CallSite } from "../call-site.js";
import type { ShapeNode } from "../nodes.js";
import { OffCanvas } from "./off-canvas.js";
import { TextChecks } from "./text-checks.js";
import type { GlyphMissing } from "./text-checks.js";

export class Audit {
  readonly offCanvas: OffCanvas;
  readonly text: TextChecks;
  /** Brushed marks whose strength the faint-mark check judges, with where the sketch drew them. */
  readonly #marks = new WeakMap<ShapeNode, CallSite>();

  constructor(canvas: { width: number; height: number }, o: { glyphMissing: GlyphMissing | undefined; fontKnown: ((family: string) => boolean) | undefined; warn: (once: string, a: { message: string; line: string | undefined }) => void }) {
    this.offCanvas = new OffCanvas(canvas);
    this.text = new TextChecks(o);
  }

  begin(): void {
    this.offCanvas.begin();
    this.text.begin();
  }

  /** The frame's draw returned. */
  end(): void {
    this.offCanvas.end();
    this.text.end();
  }

  /**
   * The walk reached a shape made at `site`; `seen` is false in mask artwork (a
   * stencil). A brushed stroke that is drawn, not erased and not marked
   * `gesture({ faint: true })` keeps its call site for the faint-mark check.
   */
  shape(node: ShapeNode, a: { seen: boolean; site: CallSite }): void {
    const s = node.style;
    if (a.seen && s.brush !== undefined && s.stroke !== undefined && !s.erase && s.brush.gesture.faint !== true) this.#marks.set(node, a.site);
  }

  /** Where the sketch drew brushed mark `node`, when its strength is judged. */
  markSite(node: ShapeNode): CallSite | undefined {
    return this.#marks.get(node);
  }
}
