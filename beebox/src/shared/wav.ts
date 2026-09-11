/**
 * WAV header builder for 16-bit PCM audio.
 *
 * One header layout, shared by every WAV byte this codebase writes (#8,
 * `docs/plans/resilient-voice-recording.md`): the server's HQ piece cutter
 * (`core/voice-recording/pieces.ts`, which wraps each ≤300 s piece of a voice
 * recording before sending it to the transcription provider). The browser
 * stages raw PCM and never builds a WAV. Isomorphic — no Node/DOM-only APIs —
 * so it lives in `shared/` rather than `core/`.
 */

const HEADER_LENGTH = 44;
const BITS_PER_SAMPLE = 16;

export interface WavHeaderParams {
  sampleRate: number;
  channels: number;
  /** Length of the PCM data that follows the header, in bytes. */
  byteLength: number;
}

/** Build a 44-byte canonical WAV header for 16-bit PCM data of `byteLength` bytes. */
export function buildWavHeader({ sampleRate, channels, byteLength }: WavHeaderParams): Uint8Array<ArrayBuffer> {
  const blockAlign = channels * (BITS_PER_SAMPLE / 8);
  const byteRate = sampleRate * blockAlign;
  const totalLength = HEADER_LENGTH + byteLength;

  const header = new ArrayBuffer(HEADER_LENGTH);
  const view = new DataView(header);
  writeAscii({ view, offset: 0, text: "RIFF" });
  view.setUint32(4, totalLength - 8, true);
  writeAscii({ view, offset: 8, text: "WAVE" });
  writeAscii({ view, offset: 12, text: "fmt " });
  view.setUint32(16, 16, true); // Subchunk1 size = 16 (PCM)
  view.setUint16(20, 1, true); // Audio format = 1 (PCM)
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeAscii({ view, offset: 36, text: "data" });
  view.setUint32(40, byteLength, true);
  return new Uint8Array(header);
}

function writeAscii({ view, offset, text }: { view: DataView; offset: number; text: string }): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.codePointAt(i) ?? 0);
}
