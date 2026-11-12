import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TeaRunOptions } from "../src/headless/tea-runtime.js";
import type { LoadedTeaModule } from "../src/headless/tea-load.js";
import { Sketch } from "../src/headless/sketch.js";
import type { ParamsDecl, ParamValues } from "../src/core/tea.js";
import { TeaUtil, TeaView } from "../src/headless/tea-view.js";

/** Fresh temp directory for a test run's out/ output. */
export function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "canvas-loop-"));
}

/** Build TeaRunOptions with sensible defaults, overridable per test. */
export function teaRunOptions(module: LoadedTeaModule, overrides: Partial<TeaRunOptions> & { outDir: string }): TeaRunOptions {
  return {
    module,
    sketchPath: "test.ts",
    frames: 10,
    seed: 42,
    fps: 60,
    every: 30,
    events: [],
    eventsPath: undefined,
    ...overrides,
  };
}

/** Read every file in a directory into a name→bytes map (sorted by name). */
export function readDirBytes(dir: string): Map<string, Buffer> {
  const files = readdirSync(dir).toSorted();
  const out = new Map<string, Buffer>();
  for (const name of files) out.set(name, readFileSync(join(dir, name)));
  return out;
}

/** Read a transcript.md from an out/ directory. */
export function readTranscript(dir: string): string {
  return readFileSync(join(dir, "transcript.md"), "utf8");
}

/** What `teaView` hands back: the View, its pixels, what it logged, and the engine hooks a test may need. */
export interface TeaViewHarness {
  v: TeaView;
  /** A `Util` over the same engine (for `u.record` and `u.random`). */
  u: TeaUtil<Record<string, never>>;
  alpha: (x: number, y: number) => number;
  rgba: (x: number, y: number) => number[];
  /** The whole canvas as RGBA bytes. */
  pixels: () => Uint8ClampedArray;
  /** Draw this frame's `--outline` overlay, as the runtime does after `draw`. */
  finishFrame: () => void;
  logs: string[];
}

/** A TEA `View` over a fresh headless canvas, its pixels, and what it logged (the TEA test harness). */
export function teaView(size: { width: number; height: number }, options?: { seed?: number; outline?: boolean; decl?: ParamsDecl; values?: ParamValues<ParamsDecl> }): TeaViewHarness {
  const opts = options ?? {};
  const logs: string[] = [];
  const sketch = new Sketch({ host: { recordLog: (entry) => logs.push(entry.message), requestSnapshot: () => {} }, seed: opts.seed ?? 1, fps: 60, onHandled: () => {}, outline: opts.outline === true });
  sketch.createCanvas(size.width, size.height);
  const v = new TeaView({ sketch, decl: opts.decl ?? {}, getParams: () => opts.values ?? {} });
  const u = new TeaUtil<Record<string, never>>({ sketch, getParams: () => ({}), onHandled: () => {} });
  const rgba = (x: number, y: number): number[] => {
    const at = (y * size.width + x) * 4;
    return [...sketch.readPixels().data.slice(at, at + 4)];
  };
  return { v, u, alpha: (x, y) => rgba(x, y)[3] ?? 0, rgba, pixels: () => sketch.readPixels().data, finishFrame: () => sketch.finishFrame(), logs };
}
