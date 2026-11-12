/**
 * Wait for lines that code under test logs after its request has already
 * answered (a run that fails to start after the 200, a queue drain).
 *
 * `consoleLines` hands back only the lines logged since its last call, so the
 * lines read while waiting are kept and returned together.
 */

import { eventually } from "@ianbicking/tap-check/check";

export async function waitForLines(lines: () => string[], expected: { count: number; label: string }): Promise<string[]> {
  const seen: string[] = [];
  await eventually(() => {
    seen.push(...lines());
    return seen.length >= expected.count;
  }, { label: expected.label });
  return seen;
}
