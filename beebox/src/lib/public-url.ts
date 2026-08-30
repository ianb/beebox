/**
 * The box's public base URL, resolved from one place.
 *
 * Two entry points, one cascade:
 * - {@link getPublicUrl} — the env-only cascade (`BBX_PUBLIC_URL` → `PUBLIC_URL`
 *   → caller fallback), for callers that have no box config in hand.
 * - {@link resolveBoxPublicUrl} — the full cascade a box admin flow wants:
 *   `config/box.json#publicUrl` first (a box that pins its own URL wins), then
 *   the env cascade, then an optional caller fallback.
 *
 * `resolveBoxPublicUrl` replaces four copy-pasted `box.json ?? PUBLIC_URL`
 * blocks (Track L found them in `webapp/routes/admin.ts`,
 * `trpc/routers/admin.ts` ×2, `trpc/routers/admin-google.ts`) that each
 * silently ignored `BBX_PUBLIC_URL` — a live bug, since prod sets exactly that
 * var. Routing them all through here fixes the bug once.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "./error-guards.js";

/**
 * Resolve the public base URL from the environment, falling back to a
 * caller-supplied default. `BBX_PUBLIC_URL` wins over `PUBLIC_URL` (prod sets
 * the former); an empty string counts as unset (the `||` chain).
 */
export function getPublicUrl(fallback: string): string {
  return process.env.BBX_PUBLIC_URL || process.env.PUBLIC_URL || fallback;
}

/** Read `config/box.json#publicUrl`, or undefined when absent/unreadable. */
async function readBoxJsonPublicUrl(boxRoot: string): Promise<string | undefined> {
  try {
    const boxJson = JSON.parse(await fs.readFile(path.join(boxRoot, "config/box.json"), "utf-8"));
    if (typeof boxJson.publicUrl === "string" && boxJson.publicUrl) return boxJson.publicUrl;
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn("Could not read box.json publicUrl, falling back to env:", e);
    }
  }
  return undefined;
}

/**
 * Resolve a box's public base URL: `config/box.json#publicUrl` if set, else
 * the env cascade ({@link getPublicUrl}), else `opts.fallback`. Returns
 * undefined only when none of those yield a value.
 */
export async function resolveBoxPublicUrl(
  boxRoot: string,
  opts?: { fallback?: string },
): Promise<string | undefined> {
  const fromBox = await readBoxJsonPublicUrl(boxRoot);
  if (fromBox) return fromBox;
  const fromEnv = process.env.BBX_PUBLIC_URL || process.env.PUBLIC_URL;
  if (fromEnv) return fromEnv;
  return opts?.fallback;
}
