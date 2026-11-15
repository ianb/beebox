// The scene surface of a headless run: each `draw` is recorded as a scene
// (testing mode: pictures audited, colours parsed at the call, unknown fonts
// warned, characters with no glyph warned), and a captured frame is rendered
// by the GPU renderer on Dawn, measuring each brushed mark for the faint-mark
// warning. One
// GPU device per process, opened on first use and kept. Loaded only when a
// sketch exports `renderer = "scene"`, so a Canvas2D run never loads Dawn.
import type { TextMeasurer } from "../../core/text/measure.js";
import type { ParamsDecl, ParamValues } from "../../core/tea.js";
import type { SketchHost } from "../../core/types.js";
import { openGpu, openTextMeasurer } from "../../device/open.js";
import type { GpuHandle } from "../../device/open.js";
import { GpuRenderer } from "../../gpu/renderer.js";
import type { SceneNode } from "../../scene/nodes.js";
import { sceneOutline } from "../../scene/outline.js";
import { SceneRecorder } from "../../scene/recorder/view.js";
import { GpuRenderError } from "../../scene/errors.js";
import type { Capture, FrameSurface } from "../frame-surface.js";
import type { UtilText } from "../tea-util.js";
import { outlinesOf } from "./outlines.js";
import { faintState, faintWarnings } from "./faint.js";
import type { Outline } from "./outlines.js";

/** What one `draw` recorded. */
type FrameRecord = ReturnType<SceneRecorder["record"]>;
type DebugBox = FrameRecord["debugBoxes"][number];

let processGpu: Promise<GpuHandle | undefined> | undefined;
let processText: Promise<{ text: TextMeasurer; fontKnown: (family: string) => boolean }> | undefined;

/** The process's one GPU device (timestamps asked for, for `--timing`), or undefined when Dawn finds no adapter. */
export function sharedGpu(): Promise<GpuHandle | undefined> {
  processGpu ??= openGpu({ timestamps: true });
  return processGpu;
}

/** The text measurer the recorder lays text out with, and whether napi-rs canvas has a font family. */
function sharedText(): Promise<{ text: TextMeasurer; fontKnown: (family: string) => boolean }> {
  processText ??= (async () => {
    const { GlobalFonts } = await import("@napi-rs/canvas");
    return { text: await openTextMeasurer(), fontKnown: (family: string) => GlobalFonts.has(family) };
  })();
  return processText;
}

export interface SceneSurfaceOptions {
  readonly width: number;
  readonly height: number;
  readonly host: SketchHost;
  readonly seed: number;
  readonly decl: ParamsDecl;
  readonly getParams: () => ParamValues<ParamsDecl>;
  /** Device pixels per canvas pixel. */
  readonly ratio: number;
  /** Write each captured frame's scene outline (true), only the first captured frame's ("first"), or none. */
  readonly scene: boolean | "first";
  /** Outline debug boxes, controls, clips and placed pictures over each captured frame. */
  readonly outline: boolean;
  /** Per captured frame, the renderer's counts and (when the device grants timestamps) pass times. */
  readonly timing: boolean;
  /** Tests: open the device another way. Default: the process's one device. */
  readonly openGpu?: () => Promise<GpuHandle | undefined>;
}

/** The scene surface, or undefined when there is no GPU adapter. */
export async function openSceneSurface(o: SceneSurfaceOptions): Promise<SceneSurface | undefined> {
  const gpu = await (o.openGpu ?? sharedGpu)();
  if (gpu === undefined) return undefined;
  return new SceneSurface(o, { gpu, ...(await sharedText()) });
}

const OUTLINE_COLORS = { picture: "#ff00aa", clip: "#00c8ff", box: "#ffd000" } as const;

/** Premultiplied RGBA, as the renderer reads back, to the unpremultiplied bytes `ImageData` (and the PNG) hold. */
function unpremultiply(src: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i + 3 < src.length; i += 4) {
    const a = src[i + 3] ?? 0;
    out[i + 3] = a;
    if (a === 0) continue;
    for (let k = 0; k < 3; k++) out[i + k] = Math.round(((src[i + k] ?? 0) * 255) / a);
  }
  return out;
}

function round(ms: number): string {
  return ms.toFixed(2);
}

export class SceneSurface implements FrameSurface {
  readonly #o: SceneSurfaceOptions;
  readonly #gpu: GpuHandle;
  readonly #recorder: SceneRecorder;
  readonly #overlay: SceneRecorder;
  readonly #renderer: GpuRenderer;
  readonly #faint = faintState();
  #last: FrameRecord | undefined;
  #captures = 0;
  readonly text: UtilText;
  readonly adapter: string;

  constructor(o: SceneSurfaceOptions, a: { gpu: GpuHandle; text: TextMeasurer; fontKnown: (family: string) => boolean }) {
    this.#o = o;
    this.#gpu = a.gpu;
    this.adapter = a.gpu.description;
    const size = { width: o.width, height: o.height };
    // Headless rendering is testing mode: pictures are re-recorded and compared every frame.
    // Logs, warnings and hints reach the transcript as they happen, in call order with console output, and before a failing `draw` ends the run.
    const onNote = (note: { kind: "log" | "warn" | "hint"; message: string }): void => o.host.recordLog({ level: note.kind, message: note.message });
    this.#renderer = new GpuRenderer(a.gpu, { timing: o.timing, peaks: true });
    this.#recorder = new SceneRecorder(size, { text: a.text, audit: true, seed: o.seed, params: { decl: o.decl, values: o.getParams }, colors: a.gpu.colors, fontKnown: a.fontKnown, glyphMissing: this.#renderer.glyphMissing, onNote });
    this.#overlay = new SceneRecorder(size, { text: a.text });
    const where = { transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, pixelRatio: 1, canvas: size };
    // As `draw` measures text with no transform inside the canvas.
    this.text = {
      width: (content, options) => a.text.width(content, options),
      bounds: (...[content, box, options]) => a.text.place(content, { box, options: options ?? {}, where }).bounds,
    };
  }

  draw(paint: (v: unknown) => void): void {
    this.#last = undefined;
    const rec = this.#recorder.record((v) => paint(v));
    this.#last = rec;
    for (const label of rec.snapshots) this.#o.host.requestSnapshot(label);
  }

  async capture(): Promise<Capture> {
    const rec = this.#last;
    if (rec === undefined) throw new GpuRenderError({ detail: "capture before a frame was drawn" });
    // Control stand-ins, then the outline overlay, draw above the scene.
    const overlay = this.#o.outline ? this.#outlines(rec.debugBoxes, outlinesOf(rec.scene.children)) : [];
    const px = await this.#renderer.render({ ...rec.scene, children: [...rec.scene.children, ...rec.standIns, ...overlay] }, this.#o.ratio);
    this.#captures++;
    this.#warnFaint();
    const first = this.#captures === 1;
    const block = this.#o.scene === true || (this.#o.scene === "first" && first) ? sceneOutline(rec.scene, this.#gpu.colors) : undefined;
    return { pixels: { width: px.width, height: px.height, data: unpremultiply(px.data) }, lines: this.#o.timing ? this.#timingLines() : [], block };
  }

  finish(): void {
    for (const message of this.#recorder.offCanvasWarnings()) this.#o.host.recordLog({ level: "warn", message });
  }

  close(): void {
    this.#renderer.destroy();
  }

  /** Brushed marks the frame drew too faint to see (faint.ts); marks the recorder does not watch (erased, in mask artwork, `faint: true`) are skipped. */
  #warnFaint(): void {
    const marks = this.#renderer.peaks.flatMap((p) => {
      const site = this.#recorder.markSite(p.node);
      return site === undefined ? [] : [{ call: p.node.call, alpha: p.alpha, get line() { return site.line; } }];
    });
    for (const message of faintWarnings(marks, this.#faint)) this.#o.host.recordLog({ level: "warn", message });
  }

  /** `--outline`: each box, clip and placement as a stroke with a see-through label, as today's painter draws them. */
  #outlines(boxes: readonly DebugBox[], cuts: readonly Outline[]): readonly SceneNode[] {
    const all = [...cuts, ...boxes.map((b) => ({ kind: "box" as const, label: b.label, points: b.corners }))];
    return this.#overlay.record((v) => {
      for (const { kind, label, points } of all) {
        const first = points[0];
        if (first === undefined) continue;
        v.polygon(points, { stroke: OUTLINE_COLORS[kind], weight: 1.5 });
        v.rect(first[0], first[1] - 12, label.length * 5.6 + 6, 12, { fill: "rgba(0,0,0,0.35)" });
        v.text(label, { x: first[0] + 3, y: first[1] - 11 }, { size: 10, fill: "#ffffff" });
      }
    }).scene.children;
  }

  /** `--timing`: the renderer's counts for this frame, and GPU pass times when the device grants timestamps. */
  #timingLines(): string[] {
    const s = this.#renderer.stats;
    const held = this.#renderer.held;
    const lines = [
      `render: passes ${s.passes}, effect passes ${s.effectPasses}, copies ${s.copies}, draws ${s.draws}; brushed strokes ${s.strokes} (expanded ${s.expanded}, cache hits ${s.cacheHits}); kept rasters ${held.tiles} (${held.tileBytes} bytes); cpu lower ${round(s.cpu.lower)} ms, encode ${round(s.cpu.encode)} ms`,
    ];
    const times = this.#renderer.gpuTimes;
    if (times !== undefined) {
      const kinds = Object.entries(times.kinds).map(([kind, t]) => `${kind} ${round(t.ms)} ms (${t.passes})`);
      lines.push(`gpu: ${round(times.spanMs)} ms; ${kinds.join(", ")}${times.untimed > 0 ? `; ${times.untimed} passes untimed` : ""}`);
    }
    return lines;
  }
}
