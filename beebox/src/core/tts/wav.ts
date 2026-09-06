/**
 * Raw PCM to a playable WAV, by prepending a 44-byte canonical header.
 *
 * Gemini's speech endpoint answers `pcm` only and rejects `mp3`, and the chat
 * player needs a container. This is a header, not a transcode: the samples are
 * copied through untouched, so it costs nothing and loses nothing.
 *
 * The defaults are Gemini's documented output — 24 kHz, mono, 16-bit signed
 * little-endian (ai.google.dev/gemini-api/docs/speech-generation) — and are
 * parameters rather than constants because the next PCM backend will differ.
 */

/** Gemini's output rate. */
const DEFAULT_SAMPLE_RATE = 24_000;

export function pcmToWav(
  pcm: Buffer,
  opts?: { sampleRate?: number; channels?: number; bitsPerSample?: number },
): Buffer {
  const sampleRate = opts?.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const channels = opts?.channels ?? 1;
  const bitsPerSample = opts?.bitsPerSample ?? 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;

  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  // Everything after this field: 36 fixed header bytes + the samples.
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // PCM fmt chunk length
  header.writeUInt16LE(1, 20); // format 1 = uncompressed PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}
