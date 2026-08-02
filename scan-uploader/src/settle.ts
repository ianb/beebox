/**
 * The settle gate: ScanSnap writes multi-page PDFs incrementally, so a file
 * touched in the last few seconds may still be growing. Skipping it here —
 * rather than hashing a truncated read — means a truncated upload never
 * happens in the first place (the restat-before-disposition in run-target.ts
 * is the second, independent layer of the same defense, covering the window
 * *after* the hash is taken).
 */

import { stat } from "node:fs/promises";

export const SETTLE_WINDOW_MS = 10_000;

export async function isSettled(filePath: string, now: number): Promise<boolean> {
  const stats = await stat(filePath);
  return now - stats.mtimeMs >= SETTLE_WINDOW_MS;
}
