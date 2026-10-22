/**
 * Shared data shapes and helpers for the TTS model comparison.
 * See README.md in this directory for the workflow.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "../..");
export const RESULTS_PATH = join(HERE, "results.json");
/** Transcoded takes, published with the site. */
export const SITE_AUDIO_DIR = join(REPO_ROOT, "site/assets/tts-comparison");
export const CARD_PATH = join(REPO_ROOT, "site/cards/develop.attach/tts-comparison.doc.card");
export const TEMPLATE_PATH = join(HERE, "page-template.md");

/**
 * The renderers' original output (MP3 and WAV, 82 MB) stays out of git, in
 * the exhibit store. Override with TTS_AUDIO_DIR.
 */
export function audioDir(): string {
  return process.env["TTS_AUDIO_DIR"] ?? join(homedir(), "src/workstream-exhibits/tts-model-comparison/tts-model-comparison/audio");
}

const VENDORS = ["google", "openai", "microsoft", "fish", "minimax", "elevenlabs", "cartesia", "deepgram", "xai", "mistral"] as const;

const modelSchema = z.strictObject({
  id: z.string(),
  /** Display name on the page. */
  name: z.string(),
  /** Selects the pill color on the page; must be a vendor site/evaluation-tags.ts knows. */
  vendor: z.enum(VENDORS),
  /** The model id sent to the API. */
  apiModel: z.string(),
  route: z.string(),
  voice: z.string(),
  listPrice: z.string(),
  /** Date the model's takes were rendered, YYYY-MM-DD. */
  rendered: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().optional(),
});
export type Model = z.infer<typeof modelSchema>;

const directionSchema = z.strictObject({
  prose: z.string(),
  tagged: z.string(),
  emotion: z.record(z.string(), z.string()).optional(),
  grok: z.string().optional(),
  markup: z.record(z.string(), z.string()).optional(),
});

const clipSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  listenFor: z.string(),
  text: z.string(),
  /** How the non-English words sound, in English spelling, with a gloss. */
  pronounce: z.string().optional(),
  direction: directionSchema.optional(),
});
export type Clip = z.infer<typeof clipSchema>;

export const VARIANTS = ["plain", "directed", "markup"] as const;
export type Variant = (typeof VARIANTS)[number];

const renderSchema = z.strictObject({
  model: z.string(),
  clip: z.string(),
  variant: z.enum(VARIANTS),
  repeat: z.number().int().nonnegative(),
  /** How direction reached the model; "none" for a plain take. */
  channel: z.string(),
  /** The exact direction-bearing request fields, for directed and markup takes. */
  sent: z.string().optional(),
  /** HTTP status; 0 when the request never completed. */
  status: z.number().int(),
  error: z.string().optional(),
  ttfbMs: z.number().optional(),
  totalMs: z.number().optional(),
  generationId: z.string().optional(),
  /** Token counts a provider reported (Gemini direct). */
  usage: z.record(z.string(), z.number()).optional(),
  /** File name in audioDir(). Absent when the render failed. */
  file: z.string().optional(),
  audioSec: z.number().optional(),
  rtf: z.number().optional(),
  costUsd: z.number().optional(),
  /** True when costUsd is list price × characters, not a billed amount. */
  costEstimated: z.boolean().optional(),
  /**
   * Only the first successful take of each model/clip/variant is transcribed.
   * The page shows only leakedWords: the other differences were mostly the
   * transcriber's (numbers as digits, foreign phrases respelled).
   */
  transcript: z.string().optional(),
  extraWords: z.array(z.string()).optional(),
  leakedWords: z.array(z.string()).optional(),
  missingWords: z.array(z.string()).optional(),
});
export type Render = z.infer<typeof renderSchema>;

const resultsSchema = z.strictObject({
  generatedAt: z.string(),
  models: z.array(modelSchema),
  clips: z.array(clipSchema),
  renders: z.array(renderSchema),
  listPrices: z.record(z.string(), z.strictObject({ usdPer1kChars: z.number(), basis: z.string() })),
  costBasis: z.record(z.string(), z.string()),
});
export type Results = z.infer<typeof resultsSchema>;

export function loadResults(): Results {
  const results = resultsSchema.parse(JSON.parse(readFileSync(RESULTS_PATH, "utf8")));
  const models = new Set(results.models.map((m) => m.id));
  const clips = new Set(results.clips.map((c) => c.id));
  const keys = new Set<string>();
  for (const r of results.renders) {
    const key = `${r.model}__${r.clip}__${r.variant}__${r.repeat}`;
    if (!models.has(r.model)) throw new Error(`render ${key} names an unknown model`);
    if (!clips.has(r.clip)) throw new Error(`render ${key} names an unknown clip`);
    if (keys.has(key)) throw new Error(`render ${key} appears twice`);
    keys.add(key);
    if (r.file !== undefined && !new RegExp(`^${escapeRegExp(key)}\\.(mp3|wav)$`).test(r.file)) throw new Error(`render ${key} has file ${r.file}`);
  }
  return results;
}

function escapeRegExp(text: string): string {
  return text.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&");
}

export function saveResults(results: Results): void {
  writeFileSync(RESULTS_PATH, `${JSON.stringify(resultsSchema.parse(results), null, 2)}\n`);
}

/** The published file for a take: the source name with a .webm extension. */
export function publishedName(file: string): string {
  return file.replace(/\.[a-z0-9]+$/, ".webm");
}

/** Lowercase words without accents: a transcriber that drops an accent still matches. */
function words(text: string): string[] {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[—–-]/g, " ").replace(/[^\p{L}\p{N}'\s]/gu, " ").split(/\s+/).filter(Boolean);
}

/** Words in `b` not matched by a word in `a`, counting repeats. */
function unmatched(a: readonly string[], b: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const w of a) counts.set(w, (counts.get(w) ?? 0) + 1);
  const out: string[] = [];
  for (const w of b) {
    const n = counts.get(w) ?? 0;
    if (n > 0) counts.set(w, n - 1);
    else out.push(w);
  }
  return out;
}

/**
 * Compare a transcript of a take with the clip's text. An extra word that
 * occurs in the sent direction but not in the text (a tag, a prose prefix)
 * counts as direction that may have been read aloud.
 */
export function transcriptCheck(params: { text: string; transcript: string; sent?: string }): Pick<Render, "extraWords" | "missingWords" | "leakedWords"> {
  const reference = words(params.text);
  const heard = words(params.transcript);
  const extraWords = unmatched(reference, heard);
  const directionWords = new Set(unmatched(reference, words(params.sent ?? "")));
  return { extraWords, missingWords: unmatched(heard, reference), leakedWords: extraWords.filter((w) => directionWords.has(w)) };
}

/**
 * A key from the machine secret store (`~/.config/beebox/secrets.json`, or
 * BBX_SECRETS_FILE), the same file `bbx secrets` manages. Never print it.
 */
export function secret(name: string): string {
  const file = process.env["BBX_SECRETS_FILE"] || join(homedir(), ".config/beebox/secrets.json");
  const store = z.object({ secrets: z.record(z.string(), z.object({ value: z.string().optional() })) }).parse(JSON.parse(readFileSync(file, "utf8")));
  const value = store.secrets[name]?.value;
  if (value === undefined || value === "") throw new Error(`secret "${name}" is not set in the machine secret store`);
  return value;
}
