/**
 * Which backend the box speaks with — `_config/tts.json`.
 *
 * Deliberately the same shape as `core/transcription/index.ts`'s config: a tiny
 * JSON file, `withCardLock` around read-merge-write, absent means defaults, and
 * a malformed file is a loud parse error rather than a silent fallback. One way
 * to do each thing (principle 8) — a second config idiom would be drift.
 *
 * The default is `openai`, and that matters: a box that never touches this
 * setting must keep sounding exactly as it did, no matter which keys it holds.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { withCardLock } from "../../lib/card-lock.js";
import { errnoCode } from "../../lib/error-guards.js";
import { TTS_BACKENDS, type TtsBackend } from "../../shared/tts-backends.js";

export interface TtsConfig {
  backend: TtsBackend;
}

const storedTtsConfigSchema = z.object({
  backend: z.enum(TTS_BACKENDS).optional(),
});
type StoredTtsConfig = z.infer<typeof storedTtsConfigSchema>;

const CONFIG_RELATIVE_PATH = "_config/tts.json";

export async function loadTtsConfig(boxRoot?: string): Promise<TtsConfig> {
  const defaults: TtsConfig = { backend: "openai" };
  if (boxRoot === undefined) return defaults;
  const configPath = path.join(boxRoot, CONFIG_RELATIVE_PATH);
  let content: string;
  try {
    content = await fs.readFile(configPath, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return defaults;
    // Permissions and I/O failures are not "no config" — surface them.
    throw e;
  }
  // A corrupted config is a real bug; let it bubble rather than silently
  // speaking in a voice the boxholder did not choose.
  const stored = storedTtsConfigSchema.parse(JSON.parse(content));
  return { backend: stored.backend ?? defaults.backend };
}

export async function updateTtsConfig(boxRoot: string, updates: Partial<StoredTtsConfig>): Promise<TtsConfig> {
  const configPath = path.join(boxRoot, CONFIG_RELATIVE_PATH);
  // Serialized so two concurrent writes cannot both read the old file and
  // drop one another's change.
  return withCardLock(configPath, async () => {
    let current: StoredTtsConfig = {};
    let content: string | null = null;
    try {
      content = await fs.readFile(configPath, "utf-8");
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") throw e;
    }
    if (content !== null) current = storedTtsConfigSchema.parse(JSON.parse(content));
    const merged: StoredTtsConfig = { ...current, ...updates };
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(merged, null, 2) + "\n");
    return loadTtsConfig(boxRoot);
  });
}
