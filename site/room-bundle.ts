// Bundles canvas-loop's site-background mount module into dist/assets/file-room.js
// (the lazily loaded page background; the loader is in room.ts).
import fs from "node:fs/promises";
import path from "node:path";
import { bundleEntry } from "@ianbicking/canvas-loop/bundle";

const CANVAS_LOOP_DIR = path.resolve(import.meta.dirname, "..", "canvas-loop");

/** Bundle the mount module and write it to `<distDir>/assets/file-room.js`. */
export async function buildRoomBundle(distDir: string): Promise<void> {
  const js = await bundleEntry(path.join(CANVAS_LOOP_DIR, "src", "browser", "site-background.ts"));
  await fs.mkdir(path.join(distDir, "assets"), { recursive: true });
  await fs.writeFile(path.join(distDir, "assets", "file-room.js"), js, "utf8");
}
