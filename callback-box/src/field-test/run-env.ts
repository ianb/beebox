/**
 * The two things a field run needs from the developer's machine rather than
 * from the scenario: the browse wrapper and the browse API key
 * (`docs/plans/agent-field-tests.md`, Track 2).
 *
 * Both are resolved up front and fail loudly. A run that discovers at minute
 * three that `bin/browse` is not where it thought has already spent a box, a
 * server and an operator session on nothing.
 */

import * as path from "node:path";
import { readFile } from "node:fs/promises";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import { fileExists } from "../lib/file-exists.js";
import { errnoCode } from "../lib/error-guards.js";

/** The browse env var whose absence makes the wrapper fail closed. */
const BROWSE_KEY_ENV = "CB_BROWSE_API_KEY";

export class BrowseCommandMissingError extends Error {
  constructor(browsePath: string) {
    super(`Field-test run cannot start: no browse wrapper at ${browsePath}`);
    this.name = "BrowseCommandMissingError";
  }
}

export class BrowseKeyMissingError extends Error {
  constructor(envPath: string) {
    super(
      `Field-test run cannot start: ${BROWSE_KEY_ENV} is set neither in the environment ` +
        `nor in ${envPath}; the operator's browser would hit the login wall.`,
    );
    this.name = "BrowseKeyMissingError";
  }
}

/** The monorepo's `bin/browse`, one level above this package. */
export async function resolveBrowseCommand(): Promise<string> {
  const browse = path.resolve(PACKAGE_ROOT, "..", "bin", "browse");
  if (!(await fileExists(browse))) throw new BrowseCommandMissingError(browse);
  return browse;
}

/** Read one `KEY=value` out of a dotenv-style file, or null. Comments, blank
 *  lines and surrounding quotes only — this is not a dotenv implementation, it
 *  is a single-key lookup in a file the developer already maintains. */
async function readEnvValue(envPath: string, key: string): Promise<string | null> {
  let text: string;
  try {
    text = await readFile(envPath, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(`${key}=`)) continue;
    return trimmed.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

/**
 * The browse API key: the environment first, then this checkout's
 * `callback-box/.env` — which is where local dev already keeps it, and the dev
 * router already reads it from. Without it the browse wrapper is fail-closed
 * and the operator would meet a login wall, so an absent key is fatal here
 * rather than a surprise inside the operator's first turn.
 */
export async function resolveBrowseKey(): Promise<string> {
  const fromEnv = process.env[BROWSE_KEY_ENV];
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  const envPath = path.join(PACKAGE_ROOT, ".env");
  const fromFile = await readEnvValue(envPath, BROWSE_KEY_ENV);
  if (fromFile !== null && fromFile !== "") return fromFile;
  throw new BrowseKeyMissingError(envPath);
}
