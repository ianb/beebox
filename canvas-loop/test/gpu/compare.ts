// Parity measures from beebox/docs/plans/canvas-loop-scene/parity-criteria.md
// section 2, as the Stage 3 probes computed them (scratch/stage3/compositing/cmp.ts):
// in premultiplied values, "flat" is the share of non-edge pixels with every
// channel within 4/255 (pass: 99%); an edge pixel is one whose 3×3
// neighbourhood in the reference spans more than 24 luminance levels, and its
// coverage difference is the luminance difference over that span (pass: mean under 0.15).

export interface Parity {
  readonly flat: number;
  readonly edgeMean: number;
  readonly maxFlat: number;
  readonly pass: boolean;
}

/** Premultiply `getImageData` bytes. */
export function premultiplied(src: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let i = 0; i + 3 < src.length; i += 4) {
    const a = src[i + 3] ?? 0;
    out[i + 3] = a;
    for (let k = 0; k < 3; k++) out[i + k] = Math.round(((src[i + k] ?? 0) * a) / 255);
  }
  return out;
}

const lum = (d: Uint8Array, i: number): number => 0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0) + 0.5 * (255 - (d[i + 3] ?? 0));

function span(ref: Uint8Array, at: { x: number; y: number; width: number; height: number }): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const yy = Math.min(at.height - 1, Math.max(0, at.y + dy));
      const xx = Math.min(at.width - 1, Math.max(0, at.x + dx));
      const l = lum(ref, (yy * at.width + xx) * 4);
      lo = Math.min(lo, l);
      hi = Math.max(hi, l);
    }
  }
  return hi - lo;
}

/** Compare `gpu` with `ref` (both premultiplied, `width` wide) inside `rect`. */
export function parity(images: { ref: Uint8Array; gpu: Uint8Array }, area: { width: number; height: number; rect: readonly [number, number, number, number] }): Parity {
  const { ref, gpu } = images;
  const [rx, ry, rw, rh] = area.rect;
  let flat = 0;
  let within = 0;
  let maxFlat = 0;
  let edges = 0;
  let edgeSum = 0;
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      const i = (y * area.width + x) * 4;
      const s = span(ref, { x, y, width: area.width, height: area.height });
      if (s > 24) {
        edges++;
        edgeSum += Math.abs(lum(ref, i) - lum(gpu, i)) / s;
        continue;
      }
      flat++;
      let m = 0;
      for (let k = 0; k < 4; k++) m = Math.max(m, Math.abs((ref[i + k] ?? 0) - (gpu[i + k] ?? 0)));
      maxFlat = Math.max(maxFlat, m);
      if (m <= 4) within++;
    }
  }
  const flatShare = flat === 0 ? 1 : within / flat;
  const edgeMean = edges === 0 ? 0 : edgeSum / edges;
  return { flat: Math.round(flatShare * 10000) / 100, edgeMean: Math.round(edgeMean * 1000) / 1000, maxFlat, pass: flatShare >= 0.99 && edgeMean < 0.15 };
}
