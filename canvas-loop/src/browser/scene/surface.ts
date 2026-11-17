// The browser runtime's surface for scene sketches: each `draw` is recorded
// (draft section 8) and the scene drawn through the GPU renderer into the
// figure's WebGPU canvas. The last record is kept: waking from sleep draws it
// again without calling `draw`, so logs and snapshots neither repeat nor go
// missing. Every GPU step (a frame, sleep's release, waking) runs in one
// queue, so a release never lands inside a frame; frames that arrive while
// one is drawing collapse to the newest.
import type { ParamsDecl, ParamValues } from "../../core/tea.js";
import type { TextBox, TextOptions, TextRun } from "../../core/paint.js";
import type { PlaygroundModule } from "../sketch-types.js";
import { SketchMountError } from "../../scene/errors.js";
import type { TextMeasure } from "../../core/text/measure.js";
import type { DrawSurface, Drawn } from "../runtime/engine.js";
import type { TextMeasurer } from "../../core/text/measure.js";
import type { ColorParser } from "../../scene/colors.js";
import { GpuRenderer } from "../../gpu/renderer.js";
import type { Pixels } from "../../gpu/renderer.js";
import { SceneRecorder } from "../../scene/recorder/view.js";
import type { Scene } from "../../scene/nodes.js";
import type { GpuHandle } from "../../device/open.js";
import type { GpuLease, LeaseGpu } from "./shared-gpu.js";
import { leaseGpu } from "./shared-gpu.js";
import { PictureCosts } from "../../scene/picture-costs.js";
import type { PictureCost } from "../../scene/picture-costs.js";

/** Everything one `draw` produced (draft section 8). */
type FrameRecord = ReturnType<SceneRecorder["record"]>;

/** One frame on screen: why it was drawn, when its work was submitted, and how long that took. */
export interface Presented {
  readonly why: "frame" | "wake";
  readonly at: number;
  readonly ms: number;
}

export interface SceneSurfaceDeps {
  readonly canvas: HTMLCanvasElement;
  readonly size: { width: number; height: number };
  readonly ratio: number;
  readonly seed: number;
  readonly decl: ParamsDecl;
  /** The sketch's `draw`, called with the recorder as its View (a scene sketch's `draw` takes the draft View). */
  readonly draw: PlaygroundModule["draw"];
  readonly text: TextMeasurer;
  /** Parses colours at the call (`colorsFrom(browser2d())`, made at mount), so a bad colour fails there, naming the call. */
  readonly colors: ColorParser;
  readonly lease: GpuLease;
  /** A frame failed to draw on the GPU: the figure stops and reports it. */
  readonly onError: (error: unknown) => void;
  /** Opens a new lease after a lost device (default: the page's shared device). */
  readonly openLease?: LeaseGpu;
  /** Makes the renderer for a device (default: `GpuRenderer`); tests pass a stand-in. */
  readonly makeRenderer?: (gpu: GpuHandle) => SurfaceRenderer;
}

/** What the surface uses of a renderer. */
export type SurfaceRenderer = Pick<GpuRenderer, "present" | "release" | "destroy" | "held" | "stats">;

/**
 * The surface that configured each canvas last. A torn-down surface's queued
 * `unconfigure` must not undo a newer surface on the same canvas (React reuses
 * the element when the module changes).
 */
const OWNERS = new WeakMap<HTMLCanvasElement, SceneSurface>();

/** `failed`: a frame threw; GPU resources are freed, the canvas keeps its last frame until teardown. */
export type State = "awake" | "asleep" | "lost" | "failed" | "destroyed";

export class SceneSurface implements DrawSurface {
  readonly #d: SceneSurfaceDeps;
  readonly #recorder: SceneRecorder;
  readonly #context: GPUCanvasContext;
  readonly textMeasure: TextMeasure;
  #lease: GpuLease;
  #renderer: SurfaceRenderer | undefined;
  #state: State = "awake";
  #params: ParamValues<ParamsDecl> = {};
  #kept: FrameRecord | undefined;
  #want: Scene | undefined;
  #frameQueued = false;
  #tail: Promise<void> = Promise.resolve();
  #log: (args: readonly unknown[]) => void = () => {};
  readonly #costs = new PictureCosts();
  /** `draw` calls recorded, and frames put on screen. */
  records = 0;
  presents = 0;
  /** Read every presented frame back into `lastPixels` (testing; costs a readback per frame). */
  capture = false;
  lastPixels: Pixels | undefined;
  /** With `capture`, the frame drawn on waking. */
  wakePixels: Pixels | undefined;
  readonly presented: Presented[] = [];
  /** Sleep frees GPU textures only, keeping CPU-side caches (brush expansions, coverage geometry, glyphs). */
  keepCpuOnSleep = false;
  /** The device was lost; the figure shows `message` until it wakes. */
  onLost: (message: string) => void = () => {};

  constructor(d: SceneSurfaceDeps) {
    this.#d = d;
    this.#lease = d.lease;
    const ctx = d.canvas.getContext("webgpu");
    if (ctx === null) throw new SketchMountError({ detail: "the canvas gave no WebGPU context (it may already have another context)" });
    this.#context = ctx;
    OWNERS.set(d.canvas, this);
    this.#recorder = new SceneRecorder(d.size, { text: d.text, colors: d.colors, seed: d.seed, params: { decl: d.decl, values: () => this.#params } });
    this.textMeasure = {
      width: (content, options) => d.text.width(content, options),
      bounds: (...[content, box, options]: [string | readonly TextRun[], TextBox, TextOptions?]) => d.text.place(content, { box, options: options ?? {}, where: { transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, pixelRatio: 1, canvas: d.size } }).bounds,
    };
    this.#attach();
  }

  /** The runtime's log sink; set once the runtime exists. */
  bind(log: (args: readonly unknown[]) => void): this {
    this.#log = log;
    return this;
  }

  #attach(): void {
    const { gpu } = this.#lease;
    this.#context.configure({ device: gpu.device, format: "rgba8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST, alphaMode: "premultiplied" });
    this.#renderer = this.#d.makeRenderer?.(gpu) ?? new GpuRenderer(gpu);
    const lease = this.#lease;
    lease.onLost((info) => {
      if (this.#lease !== lease || this.#state === "destroyed" || this.#state === "failed") return;
      this.#state = "lost";
      this.#renderer = undefined;
      this.onLost(`The GPU device was lost (${info.reason === "unknown" ? info.message : info.reason}). The figure redraws when it next comes into view.`);
    });
  }

  /**
   * A web font finished loading: forget measured widths and picture versions
   * (bodies record again), and free glyph bitmaps and picture rasters drawn
   * with the fallback font. The runtime then calls `draw` again.
   */
  forgetTextWidths(): void {
    this.#d.text.clear();
    this.#recorder.forgetPictures();
    void this.#enqueue(() => this.#renderer?.release());
  }

  draw(model: unknown, params: ParamValues<ParamsDecl>): Drawn {
    const rec = this.#record(model, params);
    this.records++;
    this.#costs.recorded(rec.pictures);
    for (const line of rec.logs) this.#log([line]);
    for (const w of rec.warnings) this.#log([`warning: ${w}`]);
    if (rec.cursor !== undefined && this.#d.canvas.style.cursor !== rec.cursor) this.#d.canvas.style.cursor = rec.cursor;
    this.#kept = rec;
    this.#show(rec.scene);
    return { placements: new Map(rec.controls.map((c) => [c.name, c.box])), scene: rec.scene };
  }

  recordScene(model: unknown, params: ParamValues<ParamsDecl>): Scene {
    return this.#record(model, params).scene;
  }

  #record(model: unknown, params: ParamValues<ParamsDecl>): FrameRecord {
    this.#params = params;
    return this.#recorder.record((v): unknown => Reflect.apply(this.#d.draw, undefined, [v, model, params]));
  }

  /** The last recorded frame (kept for waking). */
  get kept(): FrameRecord | undefined {
    return this.#kept;
  }

  /** Bytes and counts the renderer holds between frames (zero while asleep). */
  get held(): SurfaceRenderer["held"] | undefined {
    return this.#renderer?.held;
  }

  /** What new picture versions cost, by key, since the last call (picture-costs.ts): a dev readout of which pictures make frames slow. */
  pictureCosts(): PictureCost[] {
    return this.#costs.take();
  }

  /** Counts and CPU times of the last frame drawn. */
  get stats(): SurfaceRenderer["stats"] | undefined {
    return this.#renderer?.stats;
  }

  get state(): State {
    return this.#state;
  }

  get device(): GPUDevice {
    return this.#lease.gpu.device;
  }

  #enqueue(op: () => Promise<void> | void): Promise<void> {
    const run = this.#tail.then(op);
    // The caller gets `run` and sees its rejection; the tail only orders the next op after it settles.
    this.#tail = run.catch(() => {});
    return run;
  }

  #show(scene: Scene): void {
    this.#want = scene;
    if (this.#frameQueued) return;
    this.#frameQueued = true;
    void this.#enqueue(async () => {
      this.#frameQueued = false;
      const s = this.#want;
      this.#want = undefined;
      if (s !== undefined && this.#state === "awake") await this.#present(s, "frame");
    });
  }

  async #present(scene: Scene, why: Presented["why"]): Promise<void> {
    const renderer = this.#renderer;
    if (renderer === undefined) return;
    const t0 = performance.now();
    try {
      const px = await renderer.present(scene, { ratio: this.#d.ratio, target: this.#context.getCurrentTexture(), read: this.capture });
      if (renderer.stats.pictures.length > 0) this.#costs.lowered(renderer.stats.pictures);
      if (px !== undefined) this.lastPixels = px;
      if (px !== undefined && why === "wake") this.wakePixels = px;
    } catch (error) {
      // A lost device fails its frames; the loss is reported once, by `onLost`.
      if (this.#state === "awake" && this.#renderer === renderer) this.#d.onError(error);
      return;
    }
    this.presents++;
    this.presented.push({ why, at: performance.now(), ms: performance.now() - t0 });
    if (this.presented.length > 600) this.presented.splice(0, 300);
  }

  /**
   * Off screen: free every GPU texture and kept value. A recorded frame still
   * waiting is drawn first, so the frame on screen is the kept one. The
   * record, model and params stay.
   */
  sleep(): Promise<void> {
    return this.#enqueue(() => {
      if (this.#state === "awake") this.#state = "asleep";
      this.#renderer?.release({ keepCpu: this.keepCpuOnSleep });
    });
  }

  /** Back on screen: open a new device if the old one was lost, then draw the kept record again (no `draw` call). */
  wake(): Promise<void> {
    return this.#enqueue(async () => {
      if (this.#ended()) return;
      if (this.#state === "lost") await this.#reopen();
      // Torn down or failed while the new device was opening.
      if (this.#ended()) return;
      this.#state = "awake";
      if (this.#kept !== undefined) await this.#present(this.#kept.scene, "wake");
    });
  }

  #ended(): boolean {
    return this.#state === "destroyed" || this.#state === "failed";
  }

  async #reopen(): Promise<void> {
    this.#lease.release();
    const lease = await (this.#d.openLease ?? leaseGpu)();
    if (this.#ended()) {
      lease.release();
      return;
    }
    this.#lease = lease;
    this.#attach();
  }

  /** A frame threw: free the renderer and the lease (idempotent); the canvas keeps its last frame. */
  fail(): Promise<void> {
    if (this.#ended()) return this.#tail;
    this.#state = "failed";
    this.#want = undefined;
    return this.#enqueue(() => this.#freeGpu());
  }

  /** Free everything; idempotent. */
  destroy(): Promise<void> {
    if (this.#state === "destroyed") return this.#tail;
    this.#state = "destroyed";
    this.#want = undefined;
    return this.#enqueue(() => {
      this.#freeGpu();
      if (OWNERS.get(this.#d.canvas) !== this) return;
      OWNERS.delete(this.#d.canvas);
      this.#context.unconfigure();
    });
  }

  /** Resolves when every GPU step queued so far (frames, sleep, waking) has finished. */
  settled(): Promise<void> {
    return this.#tail;
  }

  #freeGpu(): void {
    this.#renderer?.destroy();
    this.#renderer = undefined;
    this.#lease.release();
  }
}
