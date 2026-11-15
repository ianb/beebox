import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TeaRunOptions } from "../src/headless/tea-runtime/runner.js";
import type { LoadedTeaModule } from "../src/headless/tea-load.js";
import { Surface } from "../src/headless/surface.js";
import type { ParamsDecl, ParamValues } from "../src/core/tea.js";
import { SeededRandom } from "../src/core/prng.js";
import { formatArgs } from "../src/core/format.js";
import { TeaView } from "../src/headless/tea-view.js";
import { TeaUtil } from "../src/headless/tea-util.js";

/** Fresh temp directory for a test run's out/ output. */
export function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "canvas-loop-"));
}

/** The two surfaces a run can draw on while the Canvas2D one remains: the module's `renderer` export picks. */
export const SURFACES = ["canvas", "scene"] as const;
export type SurfaceName = (typeof SURFACES)[number];

/** `module` set to draw on `surface`. */
export function onSurface(module: LoadedTeaModule, surface: SurfaceName): LoadedTeaModule {
  const { renderer: _renderer, ...rest } = module;
  return surface === "scene" ? { ...rest, renderer: "scene" } : rest;
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
  const host = { recordLog: (entry: { message: string }): void => void logs.push(entry.message), requestSnapshot: (): void => {} };
  const surface = new Surface({ ...size, host, outline: opts.outline === true });
  const v = new TeaView({ surface, decl: opts.decl ?? {}, getParams: () => opts.values ?? {} });
  const painter = surface.painter;
  const u = new TeaUtil<Record<string, never>>({
    random: new SeededRandom(opts.seed ?? 1),
    getParams: () => ({}),
    onHandled: () => {},
    log: (args) => void logs.push(formatArgs(args)),
    text: { width: (content, o) => painter.textWidth(content, o), bounds: (...args) => painter.plainTextBounds(...args) },
  });
  const rgba = (x: number, y: number): number[] => {
    const at = (y * size.width + x) * 4;
    return [...surface.readPixels().data.slice(at, at + 4)];
  };
  return { v, u, alpha: (x, y) => rgba(x, y)[3] ?? 0, rgba, pixels: () => surface.readPixels().data, finishFrame: () => surface.finishFrame(), logs };
}
