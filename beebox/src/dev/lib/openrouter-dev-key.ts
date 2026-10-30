/**
 * The real OpenRouter key for a dev run of pi (`pnpm pi-smoke`, `pnpm
 * knowledge-audit run --engine pi --pi-dev-key`), without touching the machine
 * secret store. The run points `BBX_SECRETS_FILE` at a scratch store whose
 * `openrouter` secret is `PI_DEV_PLACEHOLDER_KEY`, granted to the run's box,
 * so the production grant check runs unchanged. The real key,
 * `BBX_OPENROUTER_API_KEY` from the environment or `beebox/.env`, replaces the
 * placeholder only in memory, through pi's `createRuntime` seam.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { ModelRuntime, type CreateModelRuntimeOptions } from "@earendil-works/pi-coding-agent";
import type { PiSessionDeps } from "../../core/agent/pi-run/session/core.js";
import { errnoCode } from "../../shared/error-guards.js";

export const OPENROUTER_KEY_ENV = "BBX_OPENROUTER_API_KEY";
export const PI_DEV_PLACEHOLDER_KEY = "pi-dev-placeholder";

/** The session handed pi a key other than the scratch store's placeholder. */
class UnexpectedKeyError extends Error {
  constructor() {
    super("pi dev run: the session did not pass the scratch store's placeholder key");
    this.name = "UnexpectedKeyError";
  }
}

/** `BBX_OPENROUTER_API_KEY` from the environment, else from `beebox/.env`; `null` when neither has it. */
export async function openRouterDevKey(): Promise<string | null> {
  const fromEnv = process.env[OPENROUTER_KEY_ENV];
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  const envFile = resolve(import.meta.dirname, "../../../.env");
  let text: string;
  try {
    text = await readFile(envFile, "utf8");
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return null;
    throw error;
  }
  const value = parseEnv(text)[OPENROUTER_KEY_ENV];
  return value === undefined || value === "" ? null : value;
}

/** pi's real runtime, with the scratch store's placeholder swapped for the real key in memory. */
export function piDepsWithKey(key: string): PiSessionDeps {
  return {
    createRuntime: async (options: CreateModelRuntimeOptions): Promise<ModelRuntime> => {
      const runtime = await ModelRuntime.create(options);
      const set = runtime.setRuntimeApiKey.bind(runtime);
      runtime.setRuntimeApiKey = async (provider, value) => {
        if (value !== PI_DEV_PLACEHOLDER_KEY) throw new UnexpectedKeyError();
        await set(provider, key);
      };
      return runtime;
    },
  };
}
