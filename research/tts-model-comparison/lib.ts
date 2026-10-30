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
  /** The model's part of a take reference (`S-plain-gemini38lite`): lowercase letters and digits. */
  short: z.string().regex(/^[\da-z]+$/),
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

/**
 * Fixed values a provider documents but does not check: Cartesia answers 200
 * to any emotion, so a typo would pass silently. Listed at
 * docs.cartesia.ai/build-with-cartesia/sonic-3/volume-speed-emotion.
 */
const CARTESIA_EMOTIONS = [
  "neutral", "happy", "excited", "enthusiastic", "elated", "euphoric", "triumphant", "amazed", "surprised", "flirtatious", "curious",
  "content", "peaceful", "serene", "calm", "grateful", "affectionate", "trust", "sympathetic", "anticipation", "mysterious", "angry",
  "mad", "outraged", "frustrated", "agitated", "threatened", "disgusted", "contempt", "envious", "sarcastic", "ironic", "sad",
  "dejected", "melancholic", "disappointed", "hurt", "guilty", "bored", "tired", "rejected", "nostalgic", "wistful", "apologetic",
  "hesitant", "insecure", "confused", "resigned", "anxious", "panicked", "alarmed", "scared", "proud", "confident", "distant",
  "skeptical", "contemplative", "determined",
] as const;
/** MAI styles OpenRouter accepted for the Harper voice (probed 2026-10-24); any other answers 400. */
const AZURE_STYLES = ["angry", "sad", "excited", "hopeful", "shouting", "whispering", "relieved", "embarrassed", "confused", "determined", "happy", "neutral", "joyful"] as const;
/** MiniMax's documented emotions (platform.minimax.io, speech-t2a-http). OpenRouter accepts any value. */
const MINIMAX_EMOTIONS = ["happy", "sad", "angry", "fearful", "disgusted", "surprised", "calm", "fluent", "whisper"] as const;

/** One delivery request, in every form a channel takes. A form left out means that channel cannot carry it. */
const directionSchema = z.strictObject({
  /** For an instruction field, and as a prose prefix in front of the text. */
  prose: z.string(),
  /** The text with free-form bracket tags. */
  tagged: z.string().optional(),
  cartesia: z.strictObject({ emotion: z.enum(CARTESIA_EMOTIONS), speed: z.number().optional(), volume: z.number().optional() }).optional(),
  azure: z.enum(AZURE_STYLES).optional(),
  minimax: z.enum(MINIMAX_EMOTIONS).optional(),
  /** The text with Grok's events and spans. */
  grok: z.string().optional(),
  /** The text with Voxtral's [emotion=…] and [pace=…] tags. */
  voxtral: z.string().optional(),
});
export type Direction = z.infer<typeof directionSchema>;

/** One way to read a clip. Without a direction it is a text variant, which every model reads. */
const variantSchema = z.strictObject({
  id: z.string().regex(/^[a-z][\da-z-]*$/),
  label: z.string(),
  /** Replaces the clip's text, as when the variant adds Markdown. */
  text: z.string().optional(),
  direction: directionSchema.optional(),
  /** Words that mean Markdown was read aloud ("dash", "asterisk"). */
  formatting: z.array(z.string()).optional(),
});
export type Variant = z.infer<typeof variantSchema>;

const clipSchema = z.strictObject({
  /** `<code>-<name>`, used in file names. */
  id: z.string(),
  /** One capital letter, the clip's part of a take reference. */
  code: z.string().regex(/^[A-Z]$/),
  title: z.string(),
  listenFor: z.string(),
  text: z.string(),
  /** How the non-English words sound, in English spelling, with a gloss. */
  pronounce: z.string().optional(),
  variants: z.array(variantSchema).min(1),
});
export type Clip = z.infer<typeof clipSchema>;

/** The channel of a directed take a model has no channel for: a row with no file. */
export const NO_CHANNEL = "none available";

const renderSchema = z.strictObject({
  model: z.string(),
  clip: z.string(),
  variant: z.string(),
  /** How direction reached the model; "none" for a text variant, NO_CHANNEL when nothing was sent. */
  channel: z.string(),
  /** The exact direction-bearing request fields, " | " between fields. */
  sent: z.string().optional(),
  /** HTTP status; 0 when the request never completed. Absent when nothing was sent. */
  status: z.number().int().optional(),
  error: z.string().optional(),
  ttfbMs: z.number().optional(),
  totalMs: z.number().optional(),
  generationId: z.string().optional(),
  /** Token counts a provider reported (Gemini direct). */
  usage: z.record(z.string(), z.number()).optional(),
  /** File name in audioDir(). Absent when nothing was sent. */
  file: z.string().optional(),
  audioSec: z.number().optional(),
  rtf: z.number().optional(),
  costUsd: z.number().optional(),
  /** True when costUsd is list price × characters or tokens, not a billed amount. */
  costEstimated: z.boolean().optional(),
  /**
   * The page shows only leakedWords and formattingWords: the other
   * differences were mostly the transcriber's (numbers as digits, foreign
   * phrases respelled).
   */
  transcript: z.string().optional(),
  extraWords: z.array(z.string()).optional(),
  leakedWords: z.array(z.string()).optional(),
  formattingWords: z.array(z.string()).optional(),
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

/** The words a variant reads. */
export function variantText(clip: Clip, variant: Variant): string {
  return variant.text ?? clip.text;
}

/** A take's reference on the page and its anchor: `<clip code>-<variant>-<model short name>`. */
export function reference(params: { clip: Clip; variant: string; model: Model }): string {
  return `${params.clip.code}-${params.variant}-${params.model.short}`;
}

/** The source file name of a take, before its extension. */
export function takeKey(r: Pick<Render, "model" | "clip" | "variant">): string {
  return `${r.model}__${r.clip}__${r.variant}`;
}

function unique(values: readonly string[], what: string): void {
  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) throw new Error(`${what} ${v} appears twice`);
    seen.add(v);
  }
}

export function loadResults(): Results {
  const results = resultsSchema.parse(JSON.parse(readFileSync(RESULTS_PATH, "utf8")));
  unique(results.models.map((m) => m.id), "model");
  unique(results.models.map((m) => m.short), "model short name");
  unique(results.clips.map((c) => c.id), "clip");
  unique(results.clips.map((c) => c.code), "clip code");
  const models = new Set(results.models.map((m) => m.id));
  const clips = new Map(results.clips.map((c) => [c.id, c]));
  for (const c of results.clips) {
    if (!c.id.startsWith(`${c.code}-`)) throw new Error(`clip ${c.id} must start with its code ${c.code}-`);
    unique(c.variants.map((v) => `${c.id} ${v.id}`), "variant");
  }
  const keys = new Set<string>();
  for (const r of results.renders) {
    const key = takeKey(r);
    if (!models.has(r.model)) throw new Error(`render ${key} names an unknown model`);
    const clip = clips.get(r.clip);
    if (clip === undefined) throw new Error(`render ${key} names an unknown clip`);
    if (!clip.variants.some((v) => v.id === r.variant)) throw new Error(`render ${key} names variant ${r.variant}, which clip ${r.clip} does not have`);
    if (keys.has(key)) throw new Error(`render ${key} appears twice`);
    keys.add(key);
    if (r.channel === NO_CHANNEL && (r.file !== undefined || r.status !== undefined)) throw new Error(`render ${key} has no channel but has a file or status`);
    if (r.channel !== NO_CHANNEL && r.status === undefined) throw new Error(`render ${key} has a channel but no status`);
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
 * Compare a transcript of a take with the text it read. An extra word that
 * occurs in the sent direction but not in the text (a tag, a prose prefix)
 * counts as direction that may have been read aloud; an extra word from
 * `formatting` ("dash", "asterisk") as Markdown read aloud.
 */
export function transcriptCheck(params: { text: string; transcript: string; sent?: string; formatting?: readonly string[] }): Pick<Render, "extraWords" | "missingWords" | "leakedWords" | "formattingWords"> {
  const reference = words(params.text);
  const heard = words(params.transcript);
  const extraWords = unmatched(reference, heard);
  const directionWords = new Set(unmatched(reference, words(params.sent ?? "")));
  const formatting = new Set((params.formatting ?? []).flatMap(words));
  return {
    extraWords,
    missingWords: unmatched(heard, reference),
    leakedWords: extraWords.filter((w) => directionWords.has(w)),
    formattingWords: extraWords.filter((w) => formatting.has(w)),
  };
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
