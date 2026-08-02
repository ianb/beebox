/**
 * Net-new config writer for `configure`. Reads the existing config file as
 * raw JSON (or starts from `{ "targets": [] }` on ENOENT — the one place
 * ENOENT is legal), refuses to touch a file that fails to parse, and edits
 * the raw `targets` array in place so unknown keys anywhere in the document
 * survive. The candidate document is validated with the package's existing
 * strict reader's shape rules BEFORE anything touches disk — so a bad new
 * target (an empty folder, a disposition the current platform can't honor)
 * is rejected without ever overwriting a previously-valid config on disk.
 * The write itself is atomic, and its result is re-validated afterward too,
 * as a second, independent assertion that the write round-tripped correctly
 * (catches a bug in this file's own serialization, not the caller's input).
 *
 * Known, accepted limitation: this round-trips the document through
 * `JSON.parse`/`JSON.stringify`, so pathological unknown values a human
 * would never hand-write (numbers past `Number.MAX_SAFE_INTEGER`, `-0`,
 * duplicate object keys) can be normalized rather than preserved
 * byte-for-byte. Ordinary strings, booleans, and nested objects survive
 * exactly.
 */

import { readFile } from "node:fs/promises";

import { writeFileAtomic } from "./atomic-write.js";
import { loadConfig, validateParsedConfig, type Disposition } from "./config.js";
import { errorMessage, isErrnoException } from "./error-guards.js";
import { ConfigError } from "./errors.js";
import { isRecord } from "./is-record.js";

export interface RawTarget {
  readonly folder: string;
  readonly serverUrl: string;
  readonly box: string;
  readonly tokenPath: string;
  readonly disposition: Disposition;
}

export interface WriteUploaderTargetParams {
  readonly configPath: string;
  readonly target: RawTarget;
}

export async function writeUploaderTarget(params: WriteUploaderTargetParams): Promise<void> {
  const { configPath, target } = params;
  const raw = await readRawConfig(configPath);
  const targets = extractTargetsArray(configPath, raw);
  upsertTarget(configPath, { targets, target });
  // Pre-write assertion: reject a candidate the strict reader would reject
  // BEFORE it ever overwrites whatever valid config is already on disk.
  validateParsedConfig(configPath, { parsed: raw, platform: process.platform });
  await writeFileAtomic(configPath, { contents: `${JSON.stringify(raw, null, 2)}\n` });
  // Post-write assertion: the file we actually wrote round-trips through
  // the same reader — catches a bug in this writer's own serialization.
  await loadConfig(configPath);
}

async function readRawConfig(configPath: string): Promise<unknown> {
  const text = await readConfigTextOrEmpty(configPath);
  if (text === undefined) {
    return { targets: [] };
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    const message = `not valid JSON, refusing to modify: ${errorMessage(e)}`;
    throw new ConfigError(configPath, message);
  }
}

async function readConfigTextOrEmpty(configPath: string): Promise<string | undefined> {
  try {
    return await readFile(configPath, "utf-8");
  } catch (e) {
    if (isErrnoException(e) && e.code === "ENOENT") {
      return undefined;
    }
    const message = `could not read file: ${errorMessage(e)}`;
    throw new ConfigError(configPath, message);
  }
}

function extractTargetsArray(configPath: string, raw: unknown): unknown[] {
  if (!isRecord(raw) || !Array.isArray(raw.targets)) {
    throw new ConfigError(configPath, 'expected an object with a "targets" array, refusing to modify');
  }
  return raw.targets;
}

function upsertTarget(configPath: string, params: { targets: unknown[]; target: RawTarget }): void {
  const { targets, target } = params;
  const existingIndex = targets.findIndex(
    (entry) => isRecord(entry) && entry.box === target.box && entry.serverUrl === target.serverUrl,
  );
  if (existingIndex === -1) {
    targets.push({ ...target });
    return;
  }
  const existing = targets[existingIndex];
  if (existing === undefined || !isRecord(existing)) {
    const message = `targets[${String(existingIndex)}] must be an object`;
    throw new ConfigError(configPath, message);
  }
  existing.folder = target.folder;
  existing.tokenPath = target.tokenPath;
  existing.disposition = target.disposition;
}
