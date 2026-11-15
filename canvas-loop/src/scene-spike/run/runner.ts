// Headless spike run: a TEA sketch whose `draw` takes the draft 2.2 View, run
// for N frames; only captured frames are rendered (Dawn) and written as PNGs,
// with a short transcript.
//   node --import tsx src/scene-spike/run/runner.ts <sketch.ts> [--out dir] [--frames 60] [--every 30] [--seed 42] [--ratio 1] [--scene] [--events events.json]
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { Msg, ParamsDecl, ParamValues } from "../../core/tea.js";
import { toTeaModule } from "../../headless/tea-load.js";
import type { LoadedTeaModule } from "../../headless/tea-load.js";
import { bucketTeaByFrame, parseTeaEvents } from "../../headless/tea-events.js";
import type { TeaScriptEvent } from "../../headless/tea-events.js";
import { openGpu, openTextMeasurer } from "../device.js";
import type { TextMeasurer } from "../../core/painter/text/measure.js";
import type { GpuHandle } from "../device.js";
import { SketchUsageError } from "../../core/errors.js";
import { checkParam } from "../../browser/param-validate.js";
import { GpuRenderError } from "../errors.js";
import { GpuRenderer } from "../gpu/renderer.js";
import { encodePng } from "./png.js";
import { SceneRecorder } from "../recorder/view.js";
import { sceneOutline } from "../outline.js";
import { SpikeUtil } from "../util.js";

export interface SpikeRunOptions {
  readonly sketchPath: string;
  readonly outDir: string;
  readonly frames: number;
  /** Capture every Nth frame, plus the last and frames with a snapshot or an event. */
  readonly every: number;
  readonly seed: number;
  readonly ratio: number;
  /** Write each captured frame's scene outline into the transcript. */
  readonly scene: boolean;
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

class SpikeRun {
  readonly #o: SpikeRunOptions;
  readonly #mod: LoadedTeaModule;
  readonly #renderer: GpuRenderer;
  #params: ParamValues<ParamsDecl>;
  readonly #util: SpikeUtil;
  readonly #lines: string[] = [];

  readonly #text: TextMeasurer;

  constructor(o: SpikeRunOptions, a: { mod: LoadedTeaModule; renderer: GpuRenderer; text: TextMeasurer }) {
    this.#o = o;
    this.#mod = a.mod;
    this.#renderer = a.renderer;
    this.#text = a.text;
    this.#params = startParams(a.mod.params, o.initialParams ?? {});
    this.#util = new SpikeUtil({ seed: o.seed, params: () => this.#params, text: a.text, canvas: a.mod.canvas ?? { width: 400, height: 300 } });
  }

  async run(header: string): Promise<number[]> {
    const size = this.#mod.canvas ?? { width: 400, height: 300 };
    // Headless rendering is testing mode: pictures are re-recorded and compared every frame (draft section 5).
    const recorder = new SceneRecorder(size, { text: this.#text, audit: true, seed: this.#o.seed, params: { decl: this.#mod.params, values: () => this.#params } });
    const byFrame = bucketTeaByFrame(this.#o.events);
    const mouse = { x: 0, y: 0 };
    const captured: number[] = [];
    this.#lines.push(header, `canvas ${size.width}×${size.height}, ratio ${this.#o.ratio}, ${this.#o.frames} frames, seed ${this.#o.seed}`, "");
    let model: unknown = this.#call("init", [this.#util]);
    for (let frame = 0; frame < this.#o.frames; frame++) {
      let snapshot = false;
      const events = byFrame.get(frame) ?? [];
      for (const e of events) {
        if (e.type === "snapshot") snapshot = true;
        if (e.type === "param") this.#params = { ...this.#params, [e.name]: e.value };
        const msg = msgOf(e, mouse);
        if (msg !== undefined) model = this.#call("update", [model, msg, this.#util]);
      }
      model = this.#call("update", [model, { type: "tick", frame }, this.#util]);
      const params = this.#params;
      const rec = recorder.record((v) => this.#call("draw", [v, model, params]));
      const logs = [...this.#util.logs, ...rec.logs];
      for (const line of logs) this.#lines.push(`frame ${frame}: ${line}`);
      for (const w of rec.warnings) this.#lines.push(`frame ${frame}: warning: ${w}`);
      this.#util.logs = [];
      // As today: every Nth, the last, and frames with a snapshot, an event or a log.
      if (!(snapshot || events.length > 0 || logs.length > 0 || rec.snapshots.length > 0 || frame % this.#o.every === 0 || frame === this.#o.frames - 1)) continue;
      // Control stand-ins draw above the scene (draft section 8, decision 9).
      const px = await this.#renderer.render({ ...rec.scene, children: [...rec.scene.children, ...rec.standIns] }, this.#o.ratio);
      const file = `frame-${String(frame).padStart(4, "0")}.png`;
      writeFileSync(join(this.#o.outDir, file), encodePng(px));
      captured.push(frame);
      const s = this.#renderer.stats;
      this.#lines.push(`## frame ${frame}`, `![frame ${frame}](${file})`, `passes ${s.passes}, effect passes ${s.effectPasses}, copies ${s.copies}, draws ${s.draws}`);
      if (s.strokes > 0) this.#lines.push(`brushed strokes ${s.strokes}: expanded ${s.expanded}, expansion cache hits ${s.cacheHits}; mark pages ${s.markPages}, smears ${s.smears}`);
      if (this.#o.scene) this.#lines.push("```", sceneOutline(rec.scene), "```");
      this.#lines.push("");
    }
    writeFileSync(join(this.#o.outDir, "transcript.md"), `${this.#lines.join("\n")}\n`);
    return captured;
  }

  #call(name: "init" | "update" | "draw", args: unknown[]): unknown {
    const result: unknown = Reflect.apply(this.#mod[name], undefined, args);
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
    return await new SpikeRun(o, { mod, renderer, text: await openTextMeasurer() }).run(`# scene spike: ${o.sketchPath}\nadapter: ${handle.description}`);
  } finally {
    renderer.destroy();
    if (gpu === undefined) handle.destroy();
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    out: { type: "string" }, frames: { type: "string" }, every: { type: "string" }, seed: { type: "string" },
    ratio: { type: "string" }, scene: { type: "boolean" }, events: { type: "string" },
  } });
  const sketchPath = positionals[0];
  if (sketchPath === undefined) throw new GpuRenderError({ detail: "usage: runner.ts <sketch.ts> [--out dir] [--frames N] [--every N] [--seed N] [--ratio R] [--scene] [--events file]" });
  const raw = await importRecord(sketchPath);
  const events = values.events === undefined ? [] : parseTeaEvents(JSON.parse(readFileSync(values.events, "utf8")), toTeaModule(raw).params);
  const outDir = values.out ?? "out-spike";
  const captured = await runSpike({ sketchPath, outDir, frames: Number(values.frames ?? "60"), every: Number(values.every ?? "30"), seed: Number(values.seed ?? "42"), ratio: Number(values.ratio ?? "1"), scene: values.scene === true, events });
  console.log(`wrote ${captured.length} frames and transcript.md to ${outDir}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
