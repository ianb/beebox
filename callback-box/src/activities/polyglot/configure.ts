/**
 * State-mutation logic for the Polyglot `configure` tool. Kept as a plain
 * async function so tests exercise it directly — the MCP server (in
 * `setup-mcp.ts`) is a thin wrapper that validates input and calls in.
 */

import { ActivityInstance } from "../ActivityInstance.js";
import type { PolyglotLevel, PolyglotState } from "./index.js";

export interface PolyglotConfigureInput {
  language: string;
  level: PolyglotLevel;
}

/**
 * Merge `{ language, level }` into the instance's state.json. Preserves
 * any existing fields (notably `createdAt`).
 */
export async function applyPolyglotConfigure({
  instanceRoot,
  input,
}: {
  instanceRoot: string;
  input: PolyglotConfigureInput;
}): Promise<PolyglotState> {
  const instance = new ActivityInstance(instanceRoot);
  let current: Partial<PolyglotState>;
  try {
    current = await instance.readJson<PolyglotState>("state.json");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      current = { createdAt: new Date().toISOString() };
    } else {
      throw e;
    }
  }
  const next: PolyglotState = {
    language: input.language,
    level: input.level,
    createdAt: current.createdAt ?? new Date().toISOString(),
  };
  await instance.writeJson("state.json", next);
  return next;
}
