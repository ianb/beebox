/**
 * Transient connector state — machine-local, gitignored.
 *
 * Files use the pattern `<name>.state.json` (dot before "state")
 * vs the persistent `<name>-state.json` (dash before "state").
 * The `.state.*` pattern is gitignored.
 *
 * Use this for timestamps, sync tokens, and other ephemeral data
 * that would create noisy git diffs if committed.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Build the transient state file path for a connector.
 * e.g. "gmail" → "config/connectors/gmail.state.json"
 */
export function transientStatePath(boxRoot: string, connectorName: string): string {
  return path.join(boxRoot, `config/connectors/${connectorName}.state.json`);
}

interface LoadOptions<T> {
  boxRoot: string;
  connectorName: string;
  defaultValue: T;
}

/**
 * Load transient state, returning defaultValue if file doesn't exist.
 */
export async function loadTransientState<T>(opts: LoadOptions<T>): Promise<T> {
  try {
    const content = await fs.readFile(transientStatePath(opts.boxRoot, opts.connectorName), "utf-8");
    return JSON.parse(content);
  } catch (e) {
    // Transient state is gitignored and absent on first run — a missing file is
    // the normal path to defaultValue. Log so a corrupt/unreadable state file
    // isn't silently reset to defaults.
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Could not load transient state for ${opts.connectorName}, using default:`, e);
    }
    return opts.defaultValue;
  }
}

interface SaveOptions {
  boxRoot: string;
  connectorName: string;
  data: unknown;
}

/**
 * Save transient state.
 */
export async function saveTransientState(opts: SaveOptions): Promise<void> {
  const filePath = transientStatePath(opts.boxRoot, opts.connectorName);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(opts.data, null, 2) + "\n");
}
