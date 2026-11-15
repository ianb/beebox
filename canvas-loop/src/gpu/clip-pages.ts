// Clip pages: every clip of a frame drawn once, inside its own box, packed
// with the others on shared r8 pages, one pass per page (the compositing
// probe's shared pages). A nested clip multiplies by its parent, which lies on
// a page of the depth above, so pages are drawn depth by depth. A one-shape
// clip reads its coverage from the coverage atlas; a union sums windings
// (shader-compose.ts). Draws then read their clip from its page and slot.
import { shelfPack } from "./atlas.js";
import type { Frame } from "./frame.js";
import { beginPass, storage } from "./frame.js";
import type { ClipMask } from "./jobs.js";
import { heightOf, widthOf } from "./jobs.js";
import type { Rec } from "./records.js";
import { pack } from "./records.js";
import { textures } from "./draws.js";

const rectO = (r: { x0: number; y0: number; x1: number; y1: number }): number[] => [r.x0, r.y0, widthOf(r), heightOf(r)];

/** Draw every clip in `clips` (each a nonempty box) onto clip pages; sets each one's `slot` and `page`. */
export function buildClipPages(clips: readonly ClipMask[], f: Frame): void {
  const depths = [...new Set(clips.map((c) => c.depth))].toSorted((a, b) => a - b);
  for (const d of depths) {
    const level = clips.filter((c) => c.depth === d);
    const widest = level.reduce((w, c) => Math.max(w, widthOf(c.box) + 1), 0);
    const sizes = shelfPack(level, Math.max(widest, 1024));
    for (const [page, size] of sizes.entries()) {
      const tex = f.pool.acquire({ w: size.w, h: size.h, format: "r8unorm" });
      const mine = level.filter((c) => c.slot?.page === page);
      for (const c of mine) c.page = tex;
      drawPage(mine, { f, tex });
    }
  }
}

function drawPage(clips: readonly ClipMask[], a: { f: Frame; tex: GPUTexture }): void {
  const { f, tex } = a;
  const recs: Rec[] = clips.map((c) => {
    const s = c.slot ?? { page: 0, x: 0, y: 0 };
    const box = { x0: s.x, y0: s.y, x1: s.x + widthOf(c.box), y1: s.y + heightOf(c.box) };
    const parent = c.parent === null ? undefined : { box: c.parent.box, slot: c.parent.slot };
    const self = { box: c.box, slot: c.slot };
    if (c.piece !== undefined) return { box, src: 0, cov: { o: rectO(c.piece.box), slot: [c.piece.slot?.x ?? 0, c.piece.slot?.y ?? 0] }, clip: self, parent };
    return { box, src: 1, rings: c.rings, clip: self, parent };
  });
  const packed = pack(recs, { rect: { x0: 0, y0: 0, x1: tex.width, y1: tex.height }, tex });
  const g0 = f.device.createBindGroup({ layout: f.pipes.g0, entries: [{ binding: 0, resource: { buffer: storage(f, packed.draws) } }, { binding: 1, resource: { buffer: storage(f, packed.stops) } }, { binding: 2, resource: { buffer: storage(f, packed.edges) } }] });
  const pass = beginPass(f, { tex, clear: true, kind: "clip" });
  pass.setPipeline(f.pipes.draw.clipPage);
  pass.setBindGroup(0, g0);
  // Runs of clips that read the same atlas page and parent page share one draw.
  let start = 0;
  const key = (c: ClipMask): string => `${c.piece?.slot?.page ?? -1}|${c.parent?.slot?.page ?? -1}|${c.parent?.depth ?? -1}`;
  for (let i = 1; i <= clips.length; i++) {
    const c = clips[start];
    if (c === undefined) break;
    const next = clips[i];
    if (next !== undefined && key(next) === key(c)) continue;
    pass.setBindGroup(1, textures(f, { atlas: c.piece === undefined ? undefined : f.atlas[c.piece.slot?.page ?? 0]?.tex, clip: c.parent?.page }));
    pass.draw(6, i - start, 0, start);
    f.stats.draws++;
    start = i;
  }
  pass.end();
}
