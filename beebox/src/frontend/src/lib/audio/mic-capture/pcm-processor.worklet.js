/**
 * AudioWorklet processor that captures mic input and outputs
 * PCM s16le at 16kHz mono in ~300ms chunks.
 *
 * Must be loaded via audioContext.audioWorklet.addModule().
 */

const TARGET_SAMPLE_RATE = 16000;
const CHUNK_DURATION_MS = 300;
const CHUNK_SAMPLES = (TARGET_SAMPLE_RATE * CHUNK_DURATION_MS) / 1000; // 4800

class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(CHUNK_SAMPLES);
    this._offset = 0;
    // 16 kHz samples produced, and source samples consumed, since the start.
    // Each target sample's source position is computed from the count, never
    // accumulated, so 128-sample blocks at 48 kHz yield exactly 16,000 samples
    // a second (not 42 per block, 15,750) with no rounding drift over a long
    // recording: call transcripts place words by this timeline.
    this._produced = 0;
    this._consumed = 0;
  }

  _push(sample) {
    this._buffer[this._offset++] = sample;
    if (this._offset < CHUNK_SAMPLES) return;
    const int16 = new Int16Array(CHUNK_SAMPLES);
    for (let i = 0; i < CHUNK_SAMPLES; i++) {
      const s = Math.max(-1, Math.min(1, this._buffer[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    this.port.postMessage({ type: "pcm", samples: int16.buffer }, [int16.buffer]);
    this._offset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const sourceData = input[0]; // mono channel
    const ratio = sampleRate / TARGET_SAMPLE_RATE;

    // Point sampling (good enough for speech): take the source sample at or
    // just after each target sample's position.
    for (;;) {
      const at = Math.ceil(this._produced * ratio - 1e-9) - this._consumed;
      if (at >= sourceData.length) break;
      this._push(sourceData[at]);
      this._produced++;
    }
    this._consumed += sourceData.length;

    return true; // Keep processing
  }
}

registerProcessor("pcm-processor", PcmProcessor);
