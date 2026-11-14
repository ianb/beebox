// The room painted in brush dabs, the way the village ground was.
//
// The render (scene-tea.ts) says what every pixel is and how it is lit. Here the
// picture is split into small elongated dabs on a jittered grid, each laid along
// its surface: across the carpet along one of the floor's two directions, upright
// on the walls. Each pixel belongs to its nearest dab (measured along the dab's
// length), blended into the next one across a narrow border, with faint bristle
// streaks. That map is worked out once. Each frame, every dab takes the colour the
// render gives at its centre for that frame's light, so the flicker survives while
// every edge in the room becomes ragged paint.
import type { View } from "@ianbicking/canvas-loop";
import { BAKED, H, W, hash, litAt, project, toneMap } from "./scene-tea.js";

type RGB = [number, number, number];

/** Dab spacing, screen px. */
const DAB = 5;
const DW = Math.ceil(W / DAB) + 1, DH = Math.ceil(H / DAB) + 1;

/** Screen angles of the floor's two directions. */
const FLOOR_ANGLES: readonly number[] = [[1, 0, 0], [0, 0, 1]].map(([x = 0, , z = 0]) => {
  const [ax, ay] = project(0, 0, 0), [bx, by] = project(x, 0, z);
  return Math.atan2(by - ay, bx - ax);
});

interface Dab {
  x: number;
  y: number;
  angle: number;
  aspect: number;
  /** The pixel whose colour the dab takes. */
  k: number;
}

const DABS: readonly Dab[] = Array.from({ length: DW * DH }, (_, n): Dab => {
  const i = n % DW, j = Math.floor(n / DW);
  const x = (i + 0.15 + hash(i, j, 1) * 0.7) * DAB, y = (j + 0.15 + hash(i, j, 2) * 0.7) * DAB;
  const px = Math.min(W - 1, Math.floor(x)), py = Math.min(H - 1, Math.floor(y));
  const k = py * W + px;
  const face = BAKED.facing[k] ?? 0;
  const jitter = (hash(i, j, 3) - 0.5) * 0.5;
  const along = FLOOR_ANGLES[hash(Math.floor(i / 3), Math.floor(j / 2), 4) < 0.5 ? 0 : 1] ?? 0;
  const angle = face === 1 ? along + jitter * 0.6 : face === 2 || face === 3 ? Math.PI / 2 + jitter * 0.4 : hash(i, j, 5) * Math.PI;
  return { x, y, angle, aspect: face === 4 ? 1.6 : 2.6, k };
});

interface Owner {
  near: Int32Array;
  next: Int32Array;
  /** Weight of the nearer dab, 0.5..1. */
  weight: Float32Array;
  streak: Float32Array;
}

function owners(): Owner {
  const near = new Int32Array(W * H), next = new Int32Array(W * H), weight = new Float32Array(W * H), streak = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ci = Math.floor(x / DAB), cj = Math.floor(y / DAB);
      let b1 = 0, b2 = 0, d1 = Infinity, d2 = Infinity, across1 = 0;
      for (let j = cj - 2; j <= cj + 2; j++) {
        if (j < 0 || j >= DH) continue;
        for (let i = ci - 2; i <= ci + 2; i++) {
          if (i < 0 || i >= DW) continue;
          const n = j * DW + i;
          const d = DABS[n];
          if (!d) continue;
          const dx = x + 0.5 - d.x, dy = y + 0.5 - d.y;
          const c = Math.cos(d.angle), s = Math.sin(d.angle);
          const along = (dx * c + dy * s) / d.aspect, across = -dx * s + dy * c;
          const dist = along * along + across * across;
          if (dist < d1) {
            b2 = b1;
            d2 = d1;
            b1 = n;
            d1 = dist;
            across1 = across;
          } else if (dist < d2) {
            b2 = n;
            d2 = dist;
          }
        }
      }
      const k = y * W + x;
      near[k] = b1;
      next[k] = b2;
      const gap = Math.sqrt(d2) - Math.sqrt(d1);
      const t = Math.min(1, gap / 1.3);
      weight[k] = 0.5 + 0.5 * t * t * (3 - 2 * t);
      streak[k] = 1 + 0.07 * Math.sin(across1 * 2.4 + b1 * 1.7);
    }
  }
  return { near, next, weight, streak };
}
const OWNERS: Owner = owners();

/** Paints the room for one frame in dabs. */
export function paintDabs(v: View, a: { lights: readonly RGB[]; sky: RGB }): void {
  const colours = new Float32Array(DABS.length * 3);
  for (const [n, d] of DABS.entries()) {
    const [r, g, b] = litAt(d.k, a);
    // A little variation per dab, as from paint mixed by hand.
    const vary = 0.93 + hash(n, 0, 9) * 0.14;
    colours[n * 3] = r * vary;
    colours[n * 3 + 1] = g * vary;
    colours[n * 3 + 2] = b * (0.96 + hash(n, 0, 10) * 0.08) * vary;
  }
  const img = v.ctx.createImageData(W, H);
  const px = img.data;
  const { near, next, weight, streak } = OWNERS;
  for (let k = 0; k < W * H; k++) {
    const n1 = (near[k] ?? 0) * 3, n2 = (next[k] ?? 0) * 3, w = weight[k] ?? 1, s = streak[k] ?? 1;
    const q = k * 4;
    for (let ch = 0; ch < 3; ch++) {
      const c = ((colours[n1 + ch] ?? 0) * w + (colours[n2 + ch] ?? 0) * (1 - w)) * s;
      px[q + ch] = toneMap(c);
    }
    px[q + 3] = 255;
  }
  v.ctx.putImageData(img, 0, 0);
}
