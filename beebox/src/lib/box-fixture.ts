/**
 * Whether a box is a journey walk fixture: its `_config/box.json` has a
 * `fakeNotifications` key. Any present value counts, so a box that tried to
 * say "fake" never sends for real and never runs a real clock offset by
 * mistake. Read synchronously, cached by mtime, because the box clock
 * (`lib/time.ts`) is synchronous. `notifyFakeMode` and the clock offset share
 * this one rule (docs/plans/walk-simulated-time.md, Track 1).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { errnoCode } from "../shared/error-guards.js";
import { isRecord } from "../shared/is-record.js";
import { getBoxDir } from "./paths/core.js";

interface FixtureReading {
  mtimeMs: number;
  /** The `fakeNotifications` value, or undefined when the key is absent. */
  value: unknown;
}

const cache = new Map<string, FixtureReading>();
const warned = new Set<string>();

function configPath(boxRoot: string): string {
  return path.join(getBoxDir(boxRoot, "config"), "box.json");
}

/** The raw `fakeNotifications` value; undefined when the file or the key is absent or unreadable. */
export function fakeNotificationsValue(boxRoot: string): unknown {
  const file = configPath(boxRoot);
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") console.warn(`[box-fixture] could not inspect ${file}:`, e);
    cache.delete(boxRoot);
    return undefined;
  }
  const cached = cache.get(boxRoot);
  if (cached?.mtimeMs === mtimeMs) return cached.value;
  let value: unknown;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
    value = isRecord(parsed) ? parsed.fakeNotifications : undefined;
  } catch (e) {
    // An unreadable config is reported by the box config loader; here it reads as no fixture.
    if (!warned.has(file)) {
      warned.add(file);
      console.warn(`[box-fixture] could not read ${file}; treating the box as not a walk fixture:`, e);
    }
    value = undefined;
  }
  cache.set(boxRoot, { mtimeMs, value });
  return value;
}

export function isWalkFixture(boxRoot: string): boolean {
  return fakeNotificationsValue(boxRoot) !== undefined;
}
