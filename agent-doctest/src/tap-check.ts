/**
 * Tap integration for check().
 *
 * Adds t.check() and t.checkThrows() to all tap tests via prototype patching.
 * Loaded automatically via `--import` in .taprc node-arg.
 *
 * Resolves @tapjs/core from the consuming project's node_modules
 * (via process.cwd()) to avoid the dual-package singleton problem
 * when agent-doctest is linked via file: dependency.
 *
 * Usage in tests (no import needed):
 *
 *   test("example", async (t) => {
 *     t.check("actual", "expected");
 *     await t.check(asyncFn(), "expected");
 *     t.checkThrows(() => badCall(), "ErrorName", "name");
 *   });
 */

import { TestBase } from "@tapjs/core";
import { inspect, type CheckOptions, type CheckResult, type Extractions } from "./check.js";

declare module "@tapjs/core" {
  interface TestBase {
    check(
      actual: unknown,
      expected: string | CheckOptions,
    ): Extractions | Promise<Extractions>;
    checkThrows(
      fn: () => unknown,
      options: { expected: string; mode: "name" | "full" },
    ): Extractions;
  }
}

function report(t: InstanceType<typeof TestBase>, result: CheckResult): Extractions {
  (t as { currentAssert: unknown }).currentAssert = (t as { check: unknown }).check;

  if (result.pass) {
    t.pass(result.message || "");
    return result.extractions;
  }

  t.fail(result.message, {
    diff: result.diff,
    found: result.actual,
    wanted: result.expected,
  });
  return result.extractions;
}

TestBase.prototype.check = function tapCheck(actual: unknown, expected: string | CheckOptions): Extractions | Promise<Extractions> {
  const result = inspect(actual, expected);

  if (result instanceof Promise) {
    return result.then((r) => report(this, r));
  }

  return report(this, result);
};

/**
 * Assert that fn() throws an error matching expected.
 * mode="name" compares just error.name; mode="full" compares "ErrorName: message".
 * On failure, includes the caught error's stack trace in diagnostics.
 */
TestBase.prototype.checkThrows = function tapCheckThrows(
  fn: () => unknown,
  { expected, mode }: { expected: string; mode: "name" | "full" },
): Extractions {
  (this as { currentAssert: unknown }).currentAssert = (this as { checkThrows: unknown }).checkThrows;

  let caught: unknown = null;
  let label: string;
  try {
    fn();
    label = "(no error thrown)";
  } catch (e: unknown) {
    caught = e;
    if (mode === "name") {
      label = e instanceof Error ? e.name : String(e);
    } else {
      const name = e instanceof Error ? e.name : "Error";
      const msg = e instanceof Error ? e.message : String(e);
      label = `${name}: ${msg}`;
    }
  }

  const result = inspect(label, expected) as CheckResult;

  if (result.pass) {
    this.pass("");
    return result.extractions;
  }

  const extra: Record<string, unknown> = {
    diff: result.diff,
    found: result.actual,
    wanted: result.expected,
  };
  if (caught instanceof Error && caught.stack) {
    extra.stack = caught.stack;
  }
  this.fail(result.message, extra);
  return result.extractions;
};
