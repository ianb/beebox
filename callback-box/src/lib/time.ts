/**
 * Stubbable time utility for scenario testing.
 *
 * Resolution order:
 * 1. CB_TIME environment variable (ISO string)
 * 2. stubs.yaml in parent directory of boxRoot (for scenario boxes)
 * 3. Real Date.now()
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const stubsTimeSchema = z.object({ time: z.string().optional() });
type StubsTime = z.infer<typeof stubsTimeSchema>;

const stubsCache = new Map<string, StubsTime | null>();

function loadParentStubs(boxRoot: string): StubsTime | null {
  const cached = stubsCache.get(boxRoot);
  if (cached !== undefined) {
    return cached;
  }

  const stubsPath = path.join(boxRoot, "../stubs.yaml");
  try {
    const content = fs.readFileSync(stubsPath, "utf-8");
    const result = stubsTimeSchema.safeParse(parseYaml(content));
    const parsed = result.success ? result.data : null;
    stubsCache.set(boxRoot, parsed);
    return parsed;
  } catch (e) {
    // No stubs.yaml in most boxes (it's a scenario-test fixture); a missing
    // file is the normal case and stays silent. A present-but-malformed file
    // (or any non-ENOENT error) is worth surfacing before falling back.
    if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) {
      console.warn("Could not load parent stubs.yaml, using real time:", e);
    }
    stubsCache.set(boxRoot, null);
    return null;
  }
}

/**
 * Get the current time, respecting test stubs.
 *
 * @param boxRoot - Box root directory (optional; needed for stubs.yaml lookup)
 */
export function getBoxTime(boxRoot?: string): Date {
  // 1. CB_TIME env var takes priority
  const envTime = process.env.CB_TIME;
  if (envTime) {
    return new Date(envTime);
  }

  // 2. Parent stubs.yaml
  if (boxRoot) {
    const stubs = loadParentStubs(boxRoot);
    if (stubs?.time) {
      return new Date(stubs.time);
    }
  }

  // 3. Real time
  return new Date();
}

/**
 * Get the current time as an ISO string, respecting test stubs.
 */
export function getBoxTimeISO(boxRoot?: string): string {
  return getBoxTime(boxRoot).toISOString();
}

/**
 * Clear the stubs cache (for testing).
 */
export function clearTimeCache(): void {
  stubsCache.clear();
}
