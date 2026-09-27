/**
 * Presence: how many web sessions for this box had a person interacting
 * recently. The server keeps the count and writes `.beebox/presence.json` by
 * atomic rename; any process reads it. A missing, unreadable, or stale file
 * (older than 90 seconds) counts as nobody present, so an error falls toward
 * sending. See docs/implemented-plans/notifications.md (Track A).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../../lib/atomic-write.js";
import { errnoCode } from "../../lib/error-guards.js";
import { getBoxTime } from "../../lib/time.js";

const PRESENCE_FILE = "presence.json";
const STALE_MS = 90_000;

const presenceSchema = z.object({
  activeWeb: z.number().int().nonnegative(),
  updatedAt: z.string(),
});

export interface Presence {
  activeWeb: number;
}

function presencePath(boxRoot: string): string {
  return path.join(boxRoot, ".beebox", PRESENCE_FILE);
}

export async function livePresence(
  boxRoot: string,
  opts?: { now?: Date | undefined },
): Promise<Presence> {
  const now = opts?.now ?? getBoxTime(boxRoot);
  let raw: string;
  try {
    raw = await fs.readFile(presencePath(boxRoot), "utf-8");
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") console.warn("[presence] could not read presence.json, counting nobody present:", e);
    return { activeWeb: 0 };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    console.warn("[presence] presence.json is not JSON, counting nobody present:", e);
    return { activeWeb: 0 };
  }
  const parsed = presenceSchema.safeParse(json);
  if (!parsed.success) {
    console.warn(`[presence] presence.json is invalid, counting nobody present: ${parsed.error.message}`);
    return { activeWeb: 0 };
  }
  const age = now.getTime() - Date.parse(parsed.data.updatedAt);
  if (!(age <= STALE_MS)) return { activeWeb: 0 };
  return { activeWeb: parsed.data.activeWeb };
}

export async function writePresence(boxRoot: string, opts: { activeWeb: number; now: Date }): Promise<void> {
  const filePath = presencePath(boxRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeFileAtomic(filePath, {
    content: `${JSON.stringify({ activeWeb: opts.activeWeb, updatedAt: opts.now.toISOString() })}\n`,
  });
}
