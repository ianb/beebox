/**
 * Box manifest — the canonical list of boxes on this machine.
 *
 * Lives at `~/.config/cb/boxes.json`. Only `cb scheduler start` (via
 * `cb tick`) consults this manifest now — `cb serve` resolves its box(es)
 * from argv or the cwd, and multi-box serving lives behind `cb hub`, which
 * has its own manifest (`hub.json`). See `docs/scheduler.md`.
 *
 * Earlier versions stored just the scheduler's box list at
 * `~/.config/cb/scheduler.json`. We migrate it transparently on first
 * load: when `boxes.json` doesn't exist but `scheduler.json` does, the
 * file is read and rewritten under the new name. The legacy file is left
 * in place as a safety net for downgrades; it isn't authoritative once
 * `boxes.json` exists.
 */

import * as fs from "node:fs/promises";
import { fileExists } from "../../lib/file-exists.js";
import { writeFileAtomic } from "../../lib/atomic-write.js";
import * as path from "node:path";
import * as os from "node:os";
import { z } from "zod";

export interface BoxesConfig {
  /** Absolute paths to box roots. Order is preserved as-written. */
  boxes: string[];
}

const boxesConfigSchema = z.strictObject({
  boxes: z.array(z.string()),
});

const CONFIG_DIR = path.join(os.homedir(), ".config/cb");
const CONFIG_FILE = path.join(CONFIG_DIR, "boxes.json");
const LEGACY_CONFIG_FILE = path.join(CONFIG_DIR, "scheduler.json");

/**
 * Thrown when `boxes.json` (or the legacy `scheduler.json`) fails to parse
 * or validate. This is a hand-editable file, so a typo shouldn't crash the
 * CLI with a bare `SyntaxError` pointing nowhere — name the file and the
 * problem (Track D.4).
 */
export class BoxesConfigParseError extends Error {
  readonly configPath: string;
  constructor(filePath: string, opts: { cause: unknown; reason?: string }) {
    const reason =
      opts.reason ?? (opts.cause instanceof Error ? opts.cause.message : String(opts.cause));
    super(`Box manifest at ${filePath} is invalid: ${reason}. Fix or delete the file by hand.`, {
      cause: opts.cause,
    });
    this.name = "BoxesConfigParseError";
    this.configPath = filePath;
  }
}

async function readBoxesConfigFile(filePath: string): Promise<BoxesConfig> {
  const content = await fs.readFile(filePath, "utf-8");
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (e) {
    throw new BoxesConfigParseError(filePath, { cause: e });
  }
  const result = boxesConfigSchema.safeParse(json);
  if (!result.success) {
    // Format issues into one readable line each (mirrors hub-config.ts)
    // rather than dumping the raw ZodError JSON into the message.
    const reason = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new BoxesConfigParseError(filePath, { cause: result.error, reason });
  }
  return result.data;
}

/**
 * Read the manifest. Falls back to the legacy scheduler.json on first
 * run after upgrade, rewriting it under the new filename so subsequent
 * loads are direct.
 *
 * `configPath` overrides the default `~/.config/cb/boxes.json` location
 * (tests only — the legacy-migration fallback is skipped when given, since
 * that path exists to test a single hand-editable file, not the migration).
 */
export async function loadBoxesConfig(configPath?: string): Promise<BoxesConfig> {
  const targetFile = configPath ?? CONFIG_FILE;
  if (await fileExists(targetFile)) {
    return readBoxesConfigFile(targetFile);
  }
  if (configPath === undefined && (await fileExists(LEGACY_CONFIG_FILE))) {
    const parsed = await readBoxesConfigFile(LEGACY_CONFIG_FILE);
    await saveBoxesConfig(parsed);
    return parsed;
  }
  return { boxes: [] };
}

export async function saveBoxesConfig(config: BoxesConfig): Promise<void> {
  // Atomic: this is the scheduler's live box list, and a torn write leaves the
  // scheduler unable to parse it at its next start (matching how the hub's own
  // routing table is written — see src/hub/hub-config-edit.ts).
  await writeFileAtomic(CONFIG_FILE, { content: JSON.stringify(config, null, 2) + "\n" });
}

/**
 * Add a box path to the manifest. No-op if already present.
 * Returns true if added, false if already present.
 */
export async function addBoxToManifest(absPath: string): Promise<boolean> {
  const config = await loadBoxesConfig();
  if (config.boxes.includes(absPath)) return false;
  config.boxes.push(absPath);
  await saveBoxesConfig(config);
  return true;
}

/**
 * Remove a box path from the manifest. Returns true if removed,
 * false if not present.
 */
export async function removeBoxFromManifest(absPath: string): Promise<boolean> {
  const config = await loadBoxesConfig();
  const idx = config.boxes.indexOf(absPath);
  if (idx === -1) return false;
  config.boxes.splice(idx, 1);
  await saveBoxesConfig(config);
  return true;
}
