
/**
 * One-off generator for TTS audio fixtures used by the speech browser test.
 *
 * Generates a few short, distinct mp3 clips via OpenAI and writes them to
 * src/webapp/test-fixtures/tts/. The clips are committed so the test harness
 * (dev-only /dev/speech route + mock TTS) never calls OpenAI — it just serves
 * these files, optionally streamed slowly to simulate a slow backend.
 *
 * Run once (needs THINKING_OPENAI_API_KEY):
 *   pnpm tsx scripts/gen-tts-fixtures.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createOpenAIAudioService } from "../src/services/openai-audio.js";

const OUT_DIR = join(import.meta.dirname, "..", "src", "webapp", "test-fixtures", "tts");

const CLIPS: Array<{ name: string; text: string }> = [
  { name: "seg0.mp3", text: "This is the first segment of the test speech." },
  { name: "seg1.mp3", text: "And now here is the second segment, a little different." },
  { name: "seg2.mp3", text: "Finally, this is the third and last segment." },
];

async function main(): Promise<void> {
  const apiKey = process.env.THINKING_OPENAI_API_KEY;
  if (!apiKey) {
    console.error("THINKING_OPENAI_API_KEY is required to generate fixtures.");
    process.exit(1);
  }

  const audio = createOpenAIAudioService(apiKey);
  mkdirSync(OUT_DIR, { recursive: true });

  for (const clip of CLIPS) {
    const result = await audio.textToSpeech(clip.text, {
      voice: "marin",
      instructions: "Calm and clear.",
    });
    const path = join(OUT_DIR, clip.name);
    writeFileSync(path, result.audio);
    console.log(`wrote ${path} (${result.audio.length} bytes)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
