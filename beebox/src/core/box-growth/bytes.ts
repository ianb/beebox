/**
 * Disk use for the growth check: the box's content, and `.beebox` (engine
 * data — indexes, caches, logs) reported apart from it so a boxholder is not
 * told their content is growing when an index is.
 *
 * `du -sk` because it reads the same on Linux (production) and macOS (dev);
 * `find -printf %s` is GNU-only. It reports disk use, which is what runs out.
 * Content is every top-level entry except `.git` (measured as Git history),
 * `.beebox` and `node_modules`; unlike the file-count scan, a `.git` or
 * `node_modules` nested deeper is counted.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execa } from "execa";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";
import type { GrowthBytes } from "./model.js";

const NOT_CONTENT = new Set([".git", ".beebox", "node_modules"]);

class DuOutputError extends Error {
  constructor(line: string) {
    super(`du returned an unreadable line: ${line}`);
    this.name = "DuOutputError";
  }
}

async function duKiB(entries: string[], opts: { cwd: string; timeout: number }): Promise<number> {
  if (entries.length === 0) return 0;
  const { stdout } = await execa("du", ["-sk", "--", ...entries], { cwd: opts.cwd, timeout: opts.timeout });
  let total = 0;
  for (const line of stdout.split("\n").filter((l) => l.length > 0)) {
    const kib = Number(line.split("\t")[0]);
    if (!Number.isFinite(kib)) throw new DuOutputError(line);
    total += kib;
  }
  return total;
}

export async function measureBytes(boxRoot: string, deadline: number): Promise<GrowthBytes> {
  try {
    const entries = (await fs.readdir(boxRoot)).filter((name) => !NOT_CONTENT.has(name));
    const content = await duKiB(entries, { cwd: boxRoot, timeout: Math.max(1, deadline - Date.now()) });
    let engine = 0;
    try {
      await fs.stat(path.join(boxRoot, ".beebox"));
      engine = await duKiB([".beebox"], { cwd: boxRoot, timeout: Math.max(1, deadline - Date.now()) });
    } catch (e) {
      // A box with no .beebox yet has no engine data; anything else is a real failure.
      if (errnoCode(e) !== "ENOENT") throw e;
    }
    return { status: "available", contentBytes: content * 1024, engineBytes: engine * 1024 };
  } catch (error) {
    return { status: "unavailable", error: errorMessage(error) };
  }
}
