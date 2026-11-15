// Shared positions: `draw` paints with them and `update` hit-tests with them.

export const W = 960;
export const H = 720;
export const MARGIN = 32;

export const HEADER = { y: 0, h: 64 };
export const EQUATION = { x: MARGIN, y: 72, w: W - 2 * MARGIN, h: 92 };
export const PICTURE = { x: MARGIN, y: 176, w: W - 2 * MARGIN, h: 262 };
export const ARROW_GAP = 56;
export const TALLY = { x: MARGIN, y: 450, w: W - 2 * MARGIN, h: 196 };
export const TALLY_ROW = { top: TALLY.y + 44, h: 48 };
export const BANNER = { x: MARGIN, y: 656, w: W - 2 * MARGIN, h: 52 };

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The tally row `i` (hover and click target). */
export function tallyRow(i: number): Box {
  return { x: TALLY.x + 8, y: TALLY_ROW.top + i * TALLY_ROW.h, w: TALLY.w - 16, h: TALLY_ROW.h - 4 };
}

export function inside(box: Box, x: number, y: number): boolean {
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
}

/** Which tally row (if any) is under (x, y), given how many rows there are. */
export function tallyRowAt(count: number, x: number, y: number): number | null {
  for (let i = 0; i < count; i += 1) if (inside(tallyRow(i), x, y)) return i;
  return null;
}
