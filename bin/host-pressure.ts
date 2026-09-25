/**
 * Memory pressure, read the same way for the ad-hoc test wrapper
 * (bin/test-ledger.ts) and the scheduled full-suite run
 * (schedules/full-suite/run.ts): a load average measures runnable processes,
 * not a swapping host, and the 2026-09-11 full-suite incident was the latter
 * — load looked quiet at times while 18GB of swap was in use. macOS levels:
 * 1 normal, 2 warn, 4 critical.
 *
 * Parsing is separate from the `sysctl`/`vm_stat` calls so it is testable
 * without a Darwin host.
 */

import { execFileSync } from "node:child_process";

export const MEMORY_PRESSURE_WARN = 2;
export const MEMORY_PRESSURE_CRITICAL = 4;

export interface MemoryPressure {
  level: number | null;
  pageouts: number | null;
}

/** `sysctl -n kern.memorystatus_vm_pressure_level` prints a bare integer. */
export function parsePressureLevel(raw: string): number | null {
  const value = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(value) ? value : null;
}

/** `vm_stat`'s `Pageouts:` line, e.g. `Pageouts:                123456.`. */
export function parsePageouts(raw: string): number | null {
  const match = /^Pageouts:\s*(\d+)\.?\s*$/mu.exec(raw);
  if (match?.[1] === undefined) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

/**
 * Absent command, non-Darwin, or unparsable output all read as "no signal"
 * rather than throwing: this feeds a wait loop and a refusal decision, never
 * something that should itself take a run down.
 */
export function readMemoryPressure(): MemoryPressure {
  return {
    level: tryRead(["sysctl", "-n", "kern.memorystatus_vm_pressure_level"], parsePressureLevel),
    pageouts: tryRead(["vm_stat"], parsePageouts),
  };
}

export type PressureDecision = "refuse" | "warn" | "proceed";

/**
 * What `bin/test-ledger.ts` does before spawning tap: a full run under
 * critical pressure is refused outright (tap would kill it at 300s and teach
 * nothing), a full or selected run under warn just says so, and selected
 * never refuses — the cost of a wrong refusal there is a whole iteration
 * loop, against a few files' timeouts if it runs anyway.
 *
 * `ignoreLoad` bypasses only the refusal, not the warning: a caller that
 * already gated on load itself (the full-suite schedule's own
 * `waitForQuietHost`) sets it so a pressure spike between that check and
 * spawning tap can't produce a silent refusal with no TAP output — but it
 * still wants the warning surfaced if pressure is still up when tap runs.
 */
export function pressureDecision(input: { mode: "full" | "selected"; level: number | null; ignoreLoad: boolean }): PressureDecision {
  if (input.level === null) return "proceed";
  if (!input.ignoreLoad && input.mode === "full" && input.level >= MEMORY_PRESSURE_CRITICAL) return "refuse";
  if (input.level >= MEMORY_PRESSURE_WARN) return "warn";
  return "proceed";
}

function tryRead(command: [string, ...string[]], parse: (raw: string) => number | null): number | null {
  try {
    const [executable, ...args] = command;
    return parse(execFileSync(executable, args, { encoding: "utf8" }));
  } catch (_e) {
    return null;
  }
}
