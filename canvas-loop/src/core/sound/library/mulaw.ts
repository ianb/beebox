// 8-bit G.711 μ-law, the telephone codec: integer-exact, so decoding gives the
// same samples in every JavaScript engine. Half the size of 16-bit PCM, with
// quality ample for short sound effects at low gain.

const BIAS = 0x84;
const CLIP = 32_635;

/** Float samples (-1..1) to μ-law bytes. */
export function encodeMuLaw(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length);
  for (const [i, sample] of samples.entries()) {
    let s = Math.round(Math.max(-1, Math.min(1, sample)) * 32_767);
    const sign = s < 0 ? 0x80 : 0;
    s = Math.min(CLIP, Math.abs(s)) + BIAS;
    let exponent = 7;
    for (let mask = 0x40_00; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent -= 1;
    const mantissa = (s >> (exponent + 3)) & 0x0f;
    out[i] = ~(sign | (exponent << 4) | mantissa) & 0xff;
  }
  return out;
}

/** μ-law bytes to float samples (-1..1). */
export function decodeMuLaw(bytes: Uint8Array): Float32Array {
  const out = new Float32Array(bytes.length);
  for (const [i, byte] of bytes.entries()) {
    const u = ~byte & 0xff;
    const magnitude = ((((u & 0x0f) << 3) + BIAS) << ((u >> 4) & 0x07)) - BIAS;
    out[i] = ((u & 0x80) === 0 ? magnitude : -magnitude) / 32_768;
  }
  return out;
}
