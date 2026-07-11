/**
 * Scripted transcription service for tests and dev boxes.
 *
 * Selected when `config/transcription.json` sets `"service": "fake"`. Reads a
 * box-local script at `config/fake-transcription.json` and returns the entry
 * keyed by the clip filename (falling back to `"*"`), so doctests and a dev box
 * can produce deterministic transcripts + word timings with no API key. Word
 * timestamps are relative seconds from the clip start — the same shape a real
 * service returns.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import type {
  DetailedTranscriptionResult,
  TranscribeAudioParams,
  TranscriptionError,
} from "./index.js";
import { errorMessage } from "../../lib/error-guards.js";

/** One scripted transcription result. */
const fakeTranscriptionEntrySchema = z.object({
  text: z.string(),
  words: z.array(z.object({ word: z.string(), start: z.number(), end: z.number() })).optional(),
  duration: z.number().optional(),
  language: z.string().optional(),
});

/**
 * `config/fake-transcription.json` shape. Keys are the audio filename passed to
 * `transcribeAudio` (e.g. `"audio-001.webm"`), or `"*"` as a catch-all:
 *
 *   { "*": { "text": "hello world", "duration": 2,
 *            "words": [ { "word": "hello", "start": 0, "end": 1 },
 *                       { "word": "world", "start": 1, "end": 2 } ] } }
 */
const fakeTranscriptionScriptSchema = z.record(z.string(), fakeTranscriptionEntrySchema);

class FakeTranscriptionNoBoxError extends Error implements TranscriptionError {
  readonly permanent = true;
  readonly code = "fake_script_missing";
  constructor() {
    super("Fake transcription requires a boxRoot to locate config/fake-transcription.json");
    this.name = "FakeTranscriptionNoBoxError";
  }
}

class FakeTranscriptionScriptError extends Error implements TranscriptionError {
  readonly permanent = true;
  readonly code = "fake_script_missing";
  constructor(context: { configPath: string; filename: string; ioError?: string }) {
    super(
      context.ioError !== undefined
        ? `Fake transcription script at ${context.configPath} unreadable: ${context.ioError}`
        : `Fake transcription script at ${context.configPath} has no entry for "${context.filename}" or "*"`,
    );
    this.name = "FakeTranscriptionScriptError";
  }
}

/**
 * Scripted transcription. Fails permanently if no box, no script, or no
 * matching entry — a fake that silently returned empty would mask a
 * mis-scripted test.
 */
export async function transcribeAudioFake(
  params: TranscribeAudioParams,
): Promise<DetailedTranscriptionResult> {
  const { boxRoot, filename } = params;
  if (!boxRoot) throw new FakeTranscriptionNoBoxError();
  const configPath = path.join(boxRoot, "config/fake-transcription.json");
  let script: z.infer<typeof fakeTranscriptionScriptSchema>;
  try {
    script = fakeTranscriptionScriptSchema.parse(JSON.parse(await fs.readFile(configPath, "utf-8")));
  } catch (e) {
    throw new FakeTranscriptionScriptError({ configPath, filename, ioError: errorMessage(e) });
  }
  const entry = script[filename] ?? script["*"];
  if (!entry) throw new FakeTranscriptionScriptError({ configPath, filename });
  const words = entry.words ?? [];
  return {
    text: entry.text,
    duration: entry.duration ?? (words[words.length - 1]?.end ?? 0),
    language: entry.language ?? "en",
    words,
  };
}
