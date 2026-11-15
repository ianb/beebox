// Headless scene run: a TEA sketch whose `draw` takes the draft 2.2 View, run
// for N frames; only captured frames are rendered (Dawn) and written as PNGs,
// with a short transcript. Testing mode: pictures are audited, the model is
// frozen, colours are parsed at the call and unknown fonts and params are
// caught. A step that throws ends the run with an error line in the
// transcript (the frame, the step, the sketch's lines) and a `SketchRunError`.
//   node --import tsx src/headless/scene/runner.ts <sketch.ts> [--out dir] [--frames 60] [--every 30] [--seed 42] [--ratio 1] [--scene [first]] [--events events.json]
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { Msg, ParamsDecl, ParamValues } from "../../core/tea.js";
import { toTeaModule } from "../tea-load.js";
import type { LoadedTeaModule } from "../tea-load.js";
import { bucketTeaByFrame, parseTeaEvents } from "../tea-events.js";
import type { TeaScriptEvent } from "../tea-events.js";
import { openGpu, openTextMeasurer } from "../../device/open.js";
import type { TextMeasurer } from "../../core/text/measure.js";
import type { GpuHandle } from "../../device/open.js";
import { SketchUsageError } from "../../core/errors.js";
import { formatValue } from "../../core/format.js";
import { checkParam } from "../../browser/param-validate.js";
import { GpuRenderError, SketchRunError, describeError } from "../../scene/errors.js";
import { sketchFrames } from "../../scene/call-site.js";
import { assertSync, deepFreeze, guardParams } from "./guards.js";
import { GpuRenderer } from "../../gpu/renderer.js";
import { encodePng } from "./png.js";
import { SceneRecorder } from "../../scene/recorder/view.js";
import { sceneOutline } from "../../scene/outline.js";
import { SceneUtil } from "./util.js";

// Tests build a run's `Util` directly (test/gpu/cache-cases.ts); chunk 2 deletes both.
export { SceneUtil };

export interface SpikeRunOptions {
  readonly sketchPath: string;
  readonly outDir: string;
  readonly frames: number;
  /** Capture every Nth frame, plus the last and frames with a snapshot or an event. */
  readonly every: number;
  readonly seed: number;
  readonly ratio: number;
  /** Write each captured frame's scene outline into the transcript (true), only the first captured frame's ("first"), or none. */
  readonly scene: boolean | "first";
  readonly events: readonly TeaScriptEvent[];
  /** The sketch, already loaded (beebox's `figure run-one` imports the compiled entry itself); else `sketchPath` is imported. */
  readonly module?: LoadedTeaModule;
  /** Starting param values over the declared defaults, as `teaRun`'s `initialParams`; a name the module does not declare is an error. */
  readonly initialParams?: Readonly<Record<string, number | boolean | string>>;
}

/**
 * The params the first frame sees: each declared default, or its starting
 * value. As `teaRun`, a name the sketch does not declare is an error; so is a
 * value `checkParam` would refuse or adjust (a clamped number, a trigger).
 */
export function startParams(decl: ParamsDecl, initial: Readonly<Record<string, number | boolean | string>>): ParamValues<ParamsDecl> {
  for (const [name, value] of Object.entries(initial)) {
    const param = decl[name];
    if (param === undefined) throw new SketchUsageError({ detail: `initial param "${name}": the sketch declares no such param` });
    const check = checkParam(param, value);
    if (!check.ok) throw new SketchUsageError({ detail: `initial param "${name}": ${check.reason}` });
    if (check.note !== undefined) throw new SketchUsageError({ detail: `initial param "${name}": refused, since it would be ${check.note}` });
  }
  const values: Record<string, number | boolean | string> = {};
  for (const [name, p] of Object.entries(decl)) if (p.type !== "trigger") values[name] = initial[name] ?? p.default;
  return values;
}

/** Whether napi-rs canvas has a font family (headless fonts are the system's and any registered). */
async function fontLookup(): Promise<(family: string) => boolean> {
  const { GlobalFonts } = await import("@napi-rs/canvas");
  return (family) => GlobalFonts.has(family);
}

function msgOf(e: TeaScriptEvent, mouse: { x: number; y: number }): Msg | undefined {
  switch (e.type) {
    case "mousedown":
    case "mouseup":
    case "mousemove":
      mouse.x = e.x ?? mouse.x;
      mouse.y = e.y ?? mouse.y;
      return { type: e.type, x: mouse.x, y: mouse.y };
    case "keydown":
    case "keyup":
      return { type: e.type, key: e.key ?? "" };
    case "param":
      return { type: "param", name: e.name, value: e.value };
    case "trigger":
      return { type: "trigger", name: e.name };
    case "snapshot":
      return undefined;
  }
}

class SceneRun {
  readonly #o: SpikeRunOptions;
  readonly #mod: LoadedTeaModule;
  readonly #renderer: GpuRenderer;
  #params: ParamValues<ParamsDecl>;
  readonly #util: SceneUtil;
  readonly #lines: string[] = [];

  readonly #text: TextMeasurer;
  readonly #gpu: GpuHandle;
  readonly #fontKnown: (family: string) => boolean;
  /** The step running, for the error line: the frame (undefined during init) and init, update, draw or render. */
  #step: { frame: number | undefined; name: string } = { frame: undefined, name: "init" };

  constructor(o: SpikeRunOptions, a: { mod: LoadedTeaModule; renderer: GpuRenderer; text: TextMeasurer; gpu: GpuHandle; fontKnown: (family: string) => boolean }) {
    this.#o = o;
    this.#mod = a.mod;
    this.#renderer = a.renderer;
    this.#text = a.text;
    this.#gpu = a.gpu;
    this.#fontKnown = a.fontKnown;
    this.#params = guardParams(a.mod.params, startParams(a.mod.params, o.initialParams ?? {}));
    this.#util = new SceneUtil({ seed: o.seed, params: () => this.#params, text: a.text, canvas: a.mod.canvas ?? { width: 400, height: 300 } });
  }

  /** Run every frame and write the transcript; a step that throws is written as an error line, then thrown as a `SketchRunError`. */
  async run(header: string): Promise<number[]> {
    try {
      return await this.#frames(header);
    } catch (error) {
      const frames = sketchFrames(error instanceof Error ? error.stack : undefined);
      const { frame, name } = this.#step;
      this.#lines.push(`${frame === undefined ? "" : `frame ${frame}: `}error in ${name}: ${describeError(error)}`, ...frames.slice(0, 4).map((f) => `  at ${f}`));
      throw new SketchRunError({ frame, step: name, error, at: frames[0] });
    } finally {
      writeFileSync(join(this.#o.outDir, "transcript.md"), `${this.#lines.join("\n")}\n`);
    }
  }

  async #frames(header: string): Promise<number[]> {
    const size = this.#mod.canvas ?? { width: 400, height: 300 };
    // Headless rendering is testing mode: pictures are re-recorded and compared every frame (draft section 5).
    const recorder = new SceneRecorder(size, { text: this.#text, audit: true, seed: this.#o.seed, params: { decl: this.#mod.params, values: () => this.#params }, colors: this.#gpu.colors, fontKnown: this.#fontKnown });
    const byFrame = bucketTeaByFrame(this.#o.events);
    const mouse = { x: 0, y: 0 };
    const captured: number[] = [];
    this.#lines.push(header, `canvas ${size.width}×${size.height}, ratio ${this.#o.ratio}, ${this.#o.frames} frames, seed ${this.#o.seed}`, "");
    let model: unknown = this.#call("init", [this.#util]);
    for (let frame = 0; frame < this.#o.frames; frame++) {
      let snapshot = false;
      const events = byFrame.get(frame) ?? [];
      this.#step = { frame, name: "update" };
      for (const e of events) {
        if (e.type === "snapshot") snapshot = true;
        if (e.type === "param") {
          this.#params = guardParams(this.#mod.params, { ...this.#params, [e.name]: e.value });
          // As today's transcript (headless/transcript.ts).
          this.#lines.push(`frame ${frame}: param: ${e.name} → ${formatValue(e.value)}`);
        }
        const msg = msgOf(e, mouse);
        if (msg !== undefined) model = this.#call("update", [model, msg, this.#util]);
      }
      model = this.#call("update", [model, { type: "tick", frame }, this.#util]);
      const params = this.#params;
      this.#step = { frame, name: "draw" };
      const rec = recorder.record((v) => this.#call("draw", [v, model, params]));
      const logs = [...this.#util.logs, ...rec.logs];
      for (const line of logs) this.#lines.push(`frame ${frame}: ${line}`);
      for (const w of rec.warnings) this.#lines.push(`frame ${frame}: warning: ${w}`);
      for (const h of rec.hints) this.#lines.push(`frame ${frame}: hint: ${h}`);
      this.#util.logs = [];
      // As today: every Nth, the last, and frames with a snapshot, an event or a log.
      if (!(snapshot || events.length > 0 || logs.length > 0 || rec.snapshots.length > 0 || frame % this.#o.every === 0 || frame === this.#o.frames - 1)) continue;
      // Control stand-ins draw above the scene (draft section 8, decision 9).
      this.#step = { frame, name: "render" };
      const px = await this.#renderer.render({ ...rec.scene, children: [...rec.scene.children, ...rec.standIns] }, this.#o.ratio);
      const file = `frame-${String(frame).padStart(4, "0")}.png`;
      writeFileSync(join(this.#o.outDir, file), encodePng(px));
      captured.push(frame);
      const s = this.#renderer.stats;
      this.#lines.push(`## frame ${frame}`, `![frame ${frame}](${file})`, `passes ${s.passes}, effect passes ${s.effectPasses}, copies ${s.copies}, draws ${s.draws}`);
      if (s.strokes > 0) this.#lines.push(`brushed strokes ${s.strokes}: expanded ${s.expanded}, expansion cache hits ${s.cacheHits}; mark pages ${s.markPages}, smears ${s.smears}`);
      if (this.#o.scene === true || (this.#o.scene === "first" && captured.length === 1)) this.#lines.push("```", sceneOutline(rec.scene, this.#gpu.colors), "```");
      this.#lines.push("");
    }
    for (const w of recorder.offCanvasWarnings()) this.#lines.push(`end of run: warning: ${w}`);
    return captured;
  }

  /** Call a sketch function; the model it returns is frozen (as today's runtime), and a Promise is an error. */
  #call(name: "init" | "update" | "draw", args: unknown[]): unknown {
    const result: unknown = Reflect.apply(this.#mod[name], undefined, args);
    assertSync(result, name);
    if (name !== "draw") deepFreeze(result);
    return result;
  }
}

async function importRecord(path: string): Promise<Record<string, unknown>> {
  const raw: unknown = await import(pathToFileURL(resolve(path)).href);
  return typeof raw === "object" && raw !== null ? Object.fromEntries(Object.entries(raw)) : {};
}

/** Run a sketch headless under Dawn. Throws `GpuRenderError` when no adapter is found. */
export async function runSpike(o: SpikeRunOptions, gpu?: GpuHandle): Promise<number[]> {
  const mod = o.module ?? toTeaModule(await importRecord(o.sketchPath));
  const handle = gpu ?? (await openGpu());
  if (handle === undefined) throw new GpuRenderError({ detail: "no GPU adapter (Dawn found none)" });
  const renderer = new GpuRenderer(handle);
  rmSync(o.outDir, { recursive: true, force: true });
  mkdirSync(o.outDir, { recursive: true });
  try {
    return await new SceneRun(o, { mod, renderer, text: await openTextMeasurer(), gpu: handle, fontKnown: await fontLookup() }).run(`# scene run: ${o.sketchPath}\nadapter: ${handle.description}`);
  } finally {
    renderer.destroy();
    if (gpu === undefined) handle.destroy();
  }
}

/** `--scene` alone is every captured frame's outline; `--scene first` is the first captured frame's only. */
export function sceneArgs(argv: readonly string[]): string[] {
  const out: string[] = [];
  for (const [i, arg] of argv.entries()) {
    if (arg === "first" && argv[i - 1] === "--scene") continue;
    out.push(arg !== "--scene" ? arg : argv[i + 1] === "first" ? "--scene=first" : "--scene=all");
  }
  return out;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ args: sceneArgs(process.argv.slice(2)), allowPositionals: true, options: {
    out: { type: "string" }, frames: { type: "string" }, every: { type: "string" }, seed: { type: "string" },
    ratio: { type: "string" }, scene: { type: "string" }, events: { type: "string" },
  } });
  const sketchPath = positionals[0];
  if (sketchPath === undefined) throw new GpuRenderError({ detail: "usage: runner.ts <sketch.ts> [--out dir] [--frames N] [--every N] [--seed N] [--ratio R] [--scene [first]] [--events file]" });
  const raw = await importRecord(sketchPath);
  const events = values.events === undefined ? [] : parseTeaEvents(JSON.parse(readFileSync(values.events, "utf8")), toTeaModule(raw).params);
  const outDir = values.out ?? "out-scene";
  const captured = await runSpike({ sketchPath, outDir, frames: Number(values.frames ?? "60"), every: Number(values.every ?? "30"), seed: Number(values.seed ?? "42"), ratio: Number(values.ratio ?? "1"), scene: values.scene === "first" ? "first" : values.scene !== undefined, events });
  console.log(`wrote ${captured.length} frames and transcript.md to ${outDir}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
