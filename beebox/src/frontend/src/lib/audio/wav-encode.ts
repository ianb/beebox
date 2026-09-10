/**
 * Encode an array of 16-bit PCM ArrayBuffer chunks (16kHz mono, little-endian
 * — what `pcm-processor.worklet.js` emits) as a single WAV-formatted Blob.
 *
 * Used by narration mode to package the audio captured during a checkpoint
 * segment for HQ transcription. The Whisper and Voxtral non-streaming APIs
 * accept WAV directly, so no further conversion is needed. The header itself
 * is `@shared/wav.js`'s `buildWavHeader` — the one WAV header builder shared
 * with the server's HQ piece cutter (#8).
 */

import { buildWavHeader } from "@shared/wav.js";

const SAMPLE_RATE = 16_000;
const NUM_CHANNELS = 1;

export function encodePcmChunksAsWav(chunks: ArrayBuffer[]): Blob {
  const dataLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const header = buildWavHeader({ sampleRate: SAMPLE_RATE, channels: NUM_CHANNELS, byteLength: dataLength });
  return new Blob([header, ...chunks], { type: "audio/wav" });
}
