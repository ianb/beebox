/**
 * Stubbable time utility for scenario testing.
 *
 * Resolution order:
 * 1. BBX_TIME environment variable (ISO string)
 * 2. stubs.yaml in parent directory of boxRoot (for scenario boxes)
 * 3. Real Date.now(), plus the box clock offset when one applies: a journey
 *    walk fixture (lib/box-fixture.ts) with `.beebox/clock-offset.json`
 *    (docs/plans/walk-simulated-time.md, Track 1).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { errnoCode } from "../shared/error-guards.js";
import { isWalkFixture } from "./box-fixture.js";

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
  // 1. BBX_TIME env var takes priority
  const envTime = process.env.BBX_TIME;
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

  // 3. Real time, shifted on a walk fixture with a clock offset
  const offsetMs = boxRoot === undefined ? 0 : appliedOffsetMs(boxRoot);
  return new Date(Date.now() + offsetMs);
}

const offsetSchema = z.object({ offsetMs: z.number().int().nonnegative(), setAt: z.string().optional() });
const offsetCache = new Map<string, { mtimeMs: number; offsetMs: number }>();
const warnedOffset = new Set<string>();

/** The box clock offset file, written by a journey walk's wait (`phone.ts --wait`). */
export function clockOffsetPath(boxRoot: string): string {
  return path.join(boxRoot, ".beebox", "clock-offset.json");
}

/** The offset the file holds, ignoring whether it applies; 0 when absent or malformed. */
export function storedClockOffsetMs(boxRoot: string): number {
  const file = clockOffsetPath(boxRoot);
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") console.warn(`[time] could not inspect ${file}:`, e);
    offsetCache.delete(boxRoot);
    return 0;
  }
  const cached = offsetCache.get(boxRoot);
  if (cached?.mtimeMs === mtimeMs) return cached.offsetMs;
  let offsetMs = 0;
  try {
    const parsed = offsetSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf-8")));
    if (parsed.success) offsetMs = parsed.data.offsetMs;
    else if (!warnedOffset.has(file)) {
      warnedOffset.add(file);
      console.warn(`[time] ${file} is not a clock offset (${parsed.error.message}); using no offset.`);
    }
  } catch (e) {
    if (!warnedOffset.has(file)) {
      warnedOffset.add(file);
      console.warn(`[time] could not read ${file}; using no offset:`, e);
    }
  }
  offsetCache.set(boxRoot, { mtimeMs, offsetMs });
  return offsetMs;
}

function appliedOffsetMs(boxRoot: string): number {
  const offsetMs = storedClockOffsetMs(boxRoot);
  return offsetMs > 0 && isWalkFixture(boxRoot) ? offsetMs : 0;
}

/**
 * Box now minus real now on a walk fixture, else 0. Non-zero under an applied
 * offset and under `BBX_TIME` during a wait's replay, before the offset is
 * written. The agent's simulated-clock note and commit dates key on it.
 */
export function boxClockShiftMs(boxRoot: string): number {
  if (!isWalkFixture(boxRoot)) return 0;
  const shift = getBoxTime(boxRoot).getTime() - Date.now();
  // A frozen BBX_TIME a few ms behind real time is still "now".
  return Math.abs(shift) < 60_000 ? 0 : shift;
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
  offsetCache.clear();
}
