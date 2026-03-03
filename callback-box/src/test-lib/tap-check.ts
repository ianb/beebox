/**
 * Tap integration for check().
 *
 * Usage:
 *   import { checker } from "../src/test-lib/tap-check.js";
 *
 *   test("example", async (t) => {
 *     const check = checker(t);
 *     check("actual", "expected");
 *     await check(asyncFn(), "expected");
 *   });
 *
 * Routes results through t.pass()/t.fail() so tap renders
 * diffs in its YAML diagnostics instead of as uncaught exceptions.
 */

import type { TestBase } from "@tapjs/core";
import { inspect, type CheckOptions, type CheckResult } from "./check.js";

export type CheckFn = (actual: unknown, expected: string | CheckOptions) => void | Promise<void>;

export function checker(t: TestBase): CheckFn {
  function report(result: CheckResult): void {
    if (result.pass) {
      t.currentAssert = check;
      t.pass(result.message || "check passed");
      return;
    }

    t.currentAssert = check;
    t.fail(result.message, {
      diff: result.diff!,
      found: result.actual,
      wanted: result.expected,
    });
  }

  function check(actual: unknown, expected: string | CheckOptions): void | Promise<void> {
    const result = inspect(actual, expected);

    if (result instanceof Promise) {
      return result.then(report);
    }

    report(result);
  }

  return check;
}
