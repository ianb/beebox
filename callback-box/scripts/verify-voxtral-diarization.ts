
/**
 * Run a WAV file through transcribeAudioVoxtral() with diarization on
 * and print the result. Defaults to scripts/test.wav; override with
 * argv[2].
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { transcribeAudioVoxtral } from "../src/core/transcription/index-voxtral.js";

async function main(): Promise<void> {
  const file = process.argv[2] ?? path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "test.wav",
  );
  console.log(`Transcribing ${file}`);
  const audioBuffer = await readFile(file);
  const result = await transcribeAudioVoxtral(
    { audioBuffer, filename: path.basename(file) },
    { diarization: true },
  );
  console.log("\n--- result ---");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
