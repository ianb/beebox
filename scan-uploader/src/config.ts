/**
 * Config loading and strict validation. The config maps folders on the
 * boxholder's laptop to upload targets; a bad config fails closed at load
 * time with a message naming exactly what's wrong, rather than surfacing as
 * a confusing failure mid-run.
 */

import { readFile } from "node:fs/promises";

import { ConfigError } from "./errors.js";
import { errorMessage } from "./error-guards.js";
import { isRecord } from "./is-record.js";

export type Disposition = "keep" | "archive" | "trash";

export interface TargetConfig {
  readonly folder: string;
  readonly serverUrl: string;
  readonly box: string;
  readonly tokenPath: string;
  readonly disposition: Disposition;
}

export interface UploaderConfig {
  readonly targets: readonly TargetConfig[];
}

const DISPOSITIONS: readonly Disposition[] = ["keep", "archive", "trash"];

/**
 * Loads and validates the config file. Throws {@link ConfigError} on any
 * problem. `options.platform` overrides `process.platform` for the
 * darwin-only `trash` disposition check — production callers never pass it;
 * tests use it to exercise the non-macOS refusal without actually running
 * off Darwin.
 */
export async function loadConfig(
  configPath: string,
  options?: { platform?: string },
): Promise<UploaderConfig> {
  const platform = options?.platform ?? process.platform;
  const text = await readConfigText(configPath);
  const parsed = parseConfigJson(configPath, text);
  return validateParsedConfig(configPath, { parsed, platform });
}

/**
 * The shape-validation half of {@link loadConfig}, factored out so a writer
 * (`config-writer.ts`) can validate an in-memory candidate document — e.g.
 * before committing it to disk — using the exact same rules a subsequent
 * `loadConfig` would apply, rather than a second, driftable copy of them.
 */
export function validateParsedConfig(
  configPath: string,
  params: { parsed: unknown; platform: string },
): UploaderConfig {
  const { parsed, platform } = params;
  if (!isRecord(parsed) || !Array.isArray(parsed.targets)) {
    throw new ConfigError(configPath, 'expected an object with a "targets" array');
  }
  if (parsed.targets.length === 0) {
    throw new ConfigError(configPath, '"targets" must contain at least one entry');
  }
  const targets = parsed.targets.map((raw, index) =>
    validateTarget(configPath, { raw, index, platform }),
  );
  return { targets };
}

async function readConfigText(configPath: string): Promise<string> {
  try {
    return await readFile(configPath, "utf-8");
  } catch (e) {
    throw new ConfigError(configPath, `could not read file: ${errorMessage(e)}`);
  }
}

function parseConfigJson(configPath: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new ConfigError(configPath, `not valid JSON: ${errorMessage(e)}`);
  }
}

function validateTarget(
  configPath: string,
  params: { raw: unknown; index: number; platform: string },
): TargetConfig {
  const { raw, index, platform } = params;
  const label = `targets[${String(index)}]`;
  if (!isRecord(raw)) {
    throw new ConfigError(configPath, `${label} must be an object`);
  }
  const folder = requireString(configPath, { value: raw.folder, label: `${label}.folder` });
  const serverUrl = requireUrl(configPath, { value: raw.serverUrl, label: `${label}.serverUrl` });
  const box = requireString(configPath, { value: raw.box, label: `${label}.box` });
  const tokenPath = requireString(configPath, {
    value: raw.tokenPath,
    label: `${label}.tokenPath`,
  });
  const disposition = requireDisposition(configPath, {
    value: raw.disposition,
    label: `${label}.disposition`,
    platform,
  });
  return { folder, serverUrl, box, tokenPath, disposition };
}

function requireString(configPath: string, params: { value: unknown; label: string }): string {
  const { value, label } = params;
  if (typeof value !== "string" || value.length === 0) {
    throw new ConfigError(configPath, `${label} must be a non-empty string`);
  }
  return value;
}

function requireUrl(configPath: string, params: { value: unknown; label: string }): string {
  const { value, label } = params;
  const url = requireString(configPath, { value, label });
  try {
    new URL(url);
  } catch (_e) {
    throw new ConfigError(configPath, `${label} must be a valid URL`);
  }
  return url;
}

function requireDisposition(
  configPath: string,
  params: { value: unknown; label: string; platform: string },
): Disposition {
  const { value, label, platform } = params;
  if (value === undefined) {
    return "keep";
  }
  if (typeof value !== "string" || !isDisposition(value)) {
    throw new ConfigError(
      configPath,
      `${label} must be one of ${DISPOSITIONS.join(", ")} (or omitted)`,
    );
  }
  if (value === "trash" && platform !== "darwin") {
    throw new ConfigError(
      configPath,
      `${label} is "trash", which is only supported on macOS (this machine is ${platform})`,
    );
  }
  return value;
}

function isDisposition(value: string): value is Disposition {
  return value === "keep" || value === "archive" || value === "trash";
}
