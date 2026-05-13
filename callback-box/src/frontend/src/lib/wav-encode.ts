/**
 * Encode an array of 16-bit PCM ArrayBuffer chunks (16kHz mono, little-endian
 * — what `pcm-processor.worklet.js` emits) as a single WAV-formatted Blob.
 *
 * Used by narration mode to package the audio captured during a checkpoint
 * segment for HQ transcription. The Whisper and Voxtral non-streaming APIs
 * accept WAV directly, so no further conversion is needed.
 */

const SAMPLE_RATE = 16_000;
const BITS_PER_SAMPLE = 16;
const NUM_CHANNELS = 1;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;
const BYTE_RATE = SAMPLE_RATE * NUM_CHANNELS * BYTES_PER_SAMPLE;
const BLOCK_ALIGN = NUM_CHANNELS * BYTES_PER_SAMPLE;

export function encodePcmChunksAsWav(chunks: ArrayBuffer[]): Blob {
  const dataLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const headerLength = 44;
  const totalLength = headerLength + dataLength;

  const header = new ArrayBuffer(headerLength);
  const view = new DataView(header);
  // "RIFF"
  view.setUint8(0, 0x52); view.setUint8(1, 0x49); view.setUint8(2, 0x46); view.setUint8(3, 0x46);
  // Chunk size = file size - 8
  view.setUint32(4, totalLength - 8, true);
  // "WAVE"
  view.setUint8(8, 0x57); view.setUint8(9, 0x41); view.setUint8(10, 0x56); view.setUint8(11, 0x45);
  // "fmt "
  view.setUint8(12, 0x66); view.setUint8(13, 0x6d); view.setUint8(14, 0x74); view.setUint8(15, 0x20);
  // Subchunk1 size = 16 (PCM)
  view.setUint32(16, 16, true);
  // Audio format = 1 (PCM)
  view.setUint16(20, 1, true);
  view.setUint16(22, NUM_CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, BYTE_RATE, true);
  view.setUint16(32, BLOCK_ALIGN, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  // "data"
  view.setUint8(36, 0x64); view.setUint8(37, 0x61); view.setUint8(38, 0x74); view.setUint8(39, 0x61);
  view.setUint32(40, dataLength, true);

  return new Blob([header, ...chunks], { type: "audio/wav" });
}
