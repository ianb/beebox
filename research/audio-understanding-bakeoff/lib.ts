/**
 * Shared types and helpers for the audio-understanding bakeoff.
 * See README.md in this directory for the workflow.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");

/**
 * The recordings are the boxholder's own voice and are never in git. They
 * live in the exhibit store's data directory for the `audio-bakeoff` app.
 * Override with BAKEOFF_AUDIO_DIR.
 */
export function audioDir(): string {
  return process.env["BAKEOFF_AUDIO_DIR"] ?? join(homedir(), "src/workstream-exhibits/apps/audio-bakeoff/captures");
}

export interface Sample {
  id: string;
  title: string;
  capability: string;
  expected: string;
  /** Recording file name in the audio directory. */
  capture?: string;
  /** Or: an FFmpeg lavfi source that generates the audio. */
  synthetic?: string;
  n?: number;
  words?: string;
  direction?: string;
  durationMs?: number;
}

export interface Check {
  id: string;
  capability: string;
  check: string;
  /** false: recorded but excluded from totals. */
  scored?: boolean;
}

export interface Group {
  id: string;
  phase: string;
  /**
   * Which prompt the group is asked with; default "blind". "product" sends
   * each sample with beebox's own audio-question prompt and `question`.
   */
  prompt?: "blind" | "extended" | "product";
  question?: string;
  samples: string[];
  checks?: Check[];
  /** Reuse another group's checks. */
  checksFrom?: string;
}

export interface Corpus {
  version: number;
  judgeModel: string;
  capabilities: string[];
  samples: Sample[];
  groups: Group[];
}

export function loadCorpus(): Corpus {
  return JSON.parse(readFileSync(join(HERE, "corpus.json"), "utf8")) as Corpus;
}

export function sampleById(corpus: Corpus, id: string): Sample {
  const sample = corpus.samples.find((s) => s.id === id);
  if (!sample) throw new Error(`unknown sample ${id}`);
  return sample;
}

export function checksFor(corpus: Corpus, groupId: string): Check[] {
  const group = corpus.groups.find((g) => g.id === groupId);
  if (!group) throw new Error(`unknown group ${groupId}`);
  if (group.checksFrom) return checksFor(corpus, group.checksFrom);
  return group.checks ?? [];
}

/** Load provider keys from beebox/.env without overriding the caller's environment. */
export function loadEnv(): void {
  const envFile = join(REPO_ROOT, "beebox/.env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (expected in beebox/.env)`);
  return value;
}

const WAV_CACHE = join(tmpdir(), "audio-bakeoff-wav");

/** The protocol's normalization: mono, 48 kHz, 16-bit PCM WAV. Cached per sample. */
export function normalizedWav(sample: Sample): Buffer {
  mkdirSync(WAV_CACHE, { recursive: true });
  const out = join(WAV_CACHE, `${sample.id}.wav`);
  if (!existsSync(out)) {
    const input = sample.synthetic ? ["-f", "lavfi", "-i", sample.synthetic] : ["-i", join(audioDir(), sample.capture ?? "")];
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...input, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", out]);
  }
  return readFileSync(out);
}

/**
 * USD per million tokens, list price (ai.google.dev/gemini-api/docs/pricing,
 * checked 2026-10-09). Gemini 3.7/3.8 Flash double on 2027-01-01.
 */
export const PRICES: Record<string, { text: number; audio: number; output: number }> = {
  "gemini-3.8-flash": { text: 0.75, audio: 0.75, output: 3.75 },
  "gemini-3.7-flash": { text: 0.75, audio: 0.75, output: 3.75 },
  "gemini-3.1-pro-preview": { text: 2, audio: 2, output: 12 },
  "gemini-3.5-flash-lite": { text: 0.3, audio: 0.3, output: 2.5 },
  "gemini-3.5-transcribe": { text: 2, audio: 2, output: 12 },
};

/** One call: a group (blind or extended prompt), or one clip for a transcription-only model. */
export interface CallRecord {
  model: string;
  route: "gemini" | "openrouter";
  mode: "blind" | "transcribe";
  /** Group id, or sample id in transcribe mode. */
  task: string;
  repeat: number;
  /** Opaque label shown to the model → sample id. */
  labels: Record<string, string>;
  startedAt: string;
  latencyMs: number;
  modelVersion?: string | undefined;
  usage?: unknown;
  costUsd?: number | undefined;
  text?: string | undefined;
  error?: string | undefined;
}

export interface RawRun {
  date: string;
  harnessVersion: number;
  calls: CallRecord[];
}

export interface Verdict {
  id: string;
  pass: boolean;
  note: string;
}

/** callKey → the judge's verdict per check. */
export type Judged = Record<string, Verdict[]>;

export function callKey(c: Pick<CallRecord, "model" | "route" | "mode" | "task" | "repeat">): string {
  return `${c.route}:${c.model}:${c.mode}:${c.task}:${c.repeat}`;
}

export function modelLabel(c: Pick<CallRecord, "model" | "route">): string {
  return `${c.model}${c.route === "openrouter" ? " (OpenRouter)" : ""}`;
}

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

export function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** Run `jobs` with at most `limit` in flight. */
export async function pool<T>(items: T[], limit: number, job: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await job(item);
    }),
  );
}
