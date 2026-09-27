/**
 * Machine-level advisory store for engine unavailability.
 *
 * One JSON file per machine, keyed by provider, because quota exhaustion is
 * account-scoped: one box's failure should inform every box on the machine,
 * and `bbx tick` runs scripts as subprocesses, so the classification has to
 * cross process boundaries somewhere on disk anyway.
 *
 * The store is ADVISORY and fail-open: a corrupt or unreadable file is
 * treated as "no record" (with a warning). An availability hint must never
 * block agent work — with no record, runs fail noisily exactly as they did
 * before this store existed, so a broken store cannot hide anything. Records
 * self-expire at `retryAt`; no sweeper. Concurrent writers last-write-win.
 *
 * Design: docs/plans/deferred-recoverable-agent-failures.md
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../../lib/atomic-write.js";
import { BBX_STATE_DIR } from "../../lib/state-dir.js";
import { errnoCode } from "../../lib/error-guards.js";
import type { EngineProvider, EngineUnavailability } from "./engine-unavailability.js";

export interface StoredEngineUnavailability extends EngineUnavailability {
  /** ISO. When the current episode of continuous unavailability began. */
  episodeStartedAt: string;
}

const StoredSchema = z.object({
  provider: z.enum(["codex", "claude"]),
  reason: z.literal("quota-exhausted"),
  retryAt: z.string(),
  retryAtSource: z.enum(["parsed", "fallback"]),
  detectedAt: z.string(),
  message: z.string(),
  episodeStartedAt: z.string(),
});

const FileSchema = z.object({
  codex: StoredSchema.optional(),
  claude: StoredSchema.optional(),
});

type AvailabilityFile = z.infer<typeof FileSchema>;

export function engineAvailabilityFilePath(): string {
  // TODO(env-migration): test override; move into the typed env boundary.
  return (
    process.env.BBX_ENGINE_AVAILABILITY_FILE ??
    path.join(BBX_STATE_DIR, "engine-availability.json")
  );
}

async function loadFile(): Promise<AvailabilityFile> {
  const filePath = engineAvailabilityFilePath();
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`Could not read engine availability store ${filePath}; treating as empty:`, e);
    }
    return {};
  }
  try {
    return FileSchema.parse(JSON.parse(raw));
  } catch (e) {
    // Fail open: advisory data, re-derivable from the next failure.
    console.warn(`Engine availability store ${filePath} is invalid; treating as empty:`, e);
    return {};
  }
}

async function saveFile(file: AvailabilityFile): Promise<void> {
  await writeFileAtomic(engineAvailabilityFilePath(), {
    content: JSON.stringify(file, null, 2) + "\n",
  });
}

/**
 * The live unavailability record for a provider, or null when there is none
 * or it has expired (`retryAt` passed).
 */
export async function liveEngineUnavailability(options: {
  provider: EngineProvider;
  now: Date;
}): Promise<StoredEngineUnavailability | null> {
  const record = (await loadFile())[options.provider];
  if (record === undefined) return null;
  if (new Date(record.retryAt).getTime() <= options.now.getTime()) return null;
  return record;
}

/** A record within this grace after its `retryAt` still extends the episode —
 * the run that re-detects exhaustion necessarily starts after the old record
 * expired. */
const EPISODE_GRACE_MS = 30 * 60 * 1000;

/**
 * Record a freshly recognized unavailability, extending the current episode
 * when one is live (or just expired, within a grace window) so fallback holds
 * through one long outage stay a single episode. The episode is a health
 * check (`engine-quota`); it never notifies on its own.
 */
export async function recordEngineUnavailability(
  unavailability: EngineUnavailability,
): Promise<StoredEngineUnavailability> {
  const file = await loadFile();
  const previous = file[unavailability.provider];
  const detectedMs = new Date(unavailability.detectedAt).getTime();
  const extendsEpisode =
    previous !== undefined &&
    detectedMs <= new Date(previous.retryAt).getTime() + EPISODE_GRACE_MS;
  const stored: StoredEngineUnavailability = {
    ...unavailability,
    episodeStartedAt: extendsEpisode ? previous.episodeStartedAt : unavailability.detectedAt,
  };
  await saveFile({ ...file, [unavailability.provider]: stored });
  return stored;
}
