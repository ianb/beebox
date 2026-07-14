import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodePng, frameFileName, hashPixels } from "./capture.js";
import type { Pixels } from "./capture.js";
import { formatArgs } from "./format.js";
import { renderTranscript } from "./transcript.js";
import type { RunMeta, TranscriptEntry } from "./transcript.js";
import type { LogLevel, SketchHost } from "./types.js";

/** The result of a run: where the transcript went and what happened. */
export interface RunResult {
  transcriptPath: string;
  framesRun: number;
  imageCount: number;
  errors: string[];
}

/** What the recorder needs from whichever tier is driving it. */
export interface RecorderDeps {
  frames: number;
  every: number;
  /** Raw pixels of the current frame, for capture. */
  readPixels: () => Pixels;
  /** Whether the canvas exists yet (setup ran) — gates error-frame capture. */
  canvasReady: () => boolean;
}

function normalizeError(error: unknown): { name: string; message: string; stack: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack ?? "" };
  }
  return { name: "Error", message: formatArgs([error]), stack: "" };
}

/**
 * Accumulates the transcript across a frame loop: log lines, param changes,
 * captured/deduped frames, and errors — then writes out/. Both the mutable tier
 * (runtime.ts) and the TEA tier (tea-runtime.ts) drive it, so capture policy,
 * dedup, and the on-disk format are defined once.
 */
export class FrameRecorder implements SketchHost {
  #deps: RecorderDeps;
  #entries: TranscriptEntry[] = [];
  #toEncode = new Map<string, Pixels>();
  #currentFrame = 0;
  #framesAttempted = 0;
  #frameHadLog = false;
  #frameHadEvent = false;
  #frameHadSnapshot = false;
  #frameCaptured = false;
  #frameLabels: string[] = [];
  #lastHash: string | undefined;
  #lastFile: string | undefined;
  #errors: string[] = [];

  constructor(deps: RecorderDeps) {
    this.#deps = deps;
  }

  // ── SketchHost ─────────────────────────────────────────────────────
  recordLog(entry: { level: LogLevel; message: string }): void {
    this.#entries.push({ kind: "log", frame: this.#currentFrame, level: entry.level, message: entry.message });
    this.#frameHadLog = true;
  }

  requestSnapshot(label: string | undefined): void {
    this.#frameHadSnapshot = true;
    if (label !== undefined) this.#frameLabels.push(label);
  }

  /** Record an automatic param-change line (`param: speed → 2.5`). */
  recordParam(entry: { name: string; value: number | boolean | string }): void {
    this.#entries.push({ kind: "param", frame: this.#currentFrame, name: entry.name, value: entry.value });
    this.#frameHadLog = true;
  }

  // ── frame lifecycle ────────────────────────────────────────────────
  beginFrame(frame: number): void {
    this.#currentFrame = frame;
    this.#framesAttempted = frame + 1;
    this.#frameHadLog = false;
    this.#frameHadEvent = false;
    this.#frameHadSnapshot = false;
    this.#frameCaptured = false;
    this.#frameLabels = [];
  }

  /** Note whether this frame ran scripted events (part of the capture policy). */
  markEvents(hadEvents: boolean): void {
    this.#frameHadEvent = hadEvents;
  }

  captureIfNeeded(frame: number): void {
    if (this.#shouldCapture(frame)) this.#capture(frame);
  }

  recordError(error: unknown): void {
    const { name, message, stack } = normalizeError(error);
    if (this.#deps.canvasReady() && !this.#frameCaptured) {
      this.#capture(this.#currentFrame);
    }
    this.#entries.push({ kind: "error", frame: this.#currentFrame, name, message, stack });
    this.#errors.push(`[frame ${this.#currentFrame}] ${name}: ${message}`);
  }

  #shouldCapture(frame: number): boolean {
    const { frames, every } = this.#deps;
    return (
      frame === 0 ||
      frame === frames - 1 ||
      (every > 0 && frame % every === 0) ||
      this.#frameHadLog ||
      this.#frameHadEvent ||
      this.#frameHadSnapshot
    );
  }

  #capture(frame: number): void {
    const pixels = this.#deps.readPixels();
    const hash = hashPixels(pixels);
    const labels = this.#frameLabels.slice();
    this.#frameCaptured = true;
    if (hash === this.#lastHash && this.#lastFile !== undefined) {
      this.#entries.push({ kind: "image", frame, labels, file: this.#lastFile, unchanged: true });
      return;
    }
    const file = frameFileName(frame);
    this.#toEncode.set(file, pixels);
    this.#entries.push({ kind: "image", frame, labels, file, unchanged: false });
    this.#lastHash = hash;
    this.#lastFile = file;
  }

  get framesAttempted(): number {
    return this.#framesAttempted;
  }

  get errors(): readonly string[] {
    return this.#errors;
  }

  writeOutput(outDir: string, meta: RunMeta): RunResult {
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    for (const [file, pixels] of this.#toEncode) {
      writeFileSync(join(outDir, file), encodePng(pixels));
    }
    const transcriptPath = join(outDir, "transcript.md");
    writeFileSync(transcriptPath, renderTranscript(meta, this.#entries));
    return {
      transcriptPath,
      framesRun: this.#framesAttempted,
      imageCount: this.#toEncode.size,
      errors: [...this.#errors],
    };
  }
}

/**
 * Route console.log/warn/error into the recorder's frame-tagged transcript for
 * the duration of a run. Returns a restore function; always call it in a finally.
 */
export function patchConsole(host: SketchHost): () => void {
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...args: unknown[]) => host.recordLog({ level: "log", message: formatArgs(args) });
  console.warn = (...args: unknown[]) => host.recordLog({ level: "warn", message: formatArgs(args) });
  console.error = (...args: unknown[]) => host.recordLog({ level: "error", message: formatArgs(args) });
  return () => {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  };
}
