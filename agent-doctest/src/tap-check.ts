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

import { TestBase, type Extra } from "@tapjs/core";
import { inspect, type CheckOptions, type CheckResult, type Extractions } from "./check.js";

type DoctestDiagnostic = Pick<Extra, "at" | "source">;

interface DoctestCheckOptions {
  check: string | CheckOptions;
  diagnostic: DoctestDiagnostic;
}

interface DoctestThrowsOptions {
  expected: string;
  mode: "name" | "full";
  diagnostic?: DoctestDiagnostic;
}

interface DoctestCheckResult {
  result: CheckResult;
  diagnostic?: DoctestDiagnostic;
}

function isDoctestCheckOptions(value: string | CheckOptions | DoctestCheckOptions): value is DoctestCheckOptions {
  return typeof value === "object" && "check" in value;
}

declare module "@tapjs/core" {
  interface TestBase {
    check(
      actual: unknown,
      expected: string | CheckOptions | DoctestCheckOptions,
    ): Extractions | Promise<Extractions>;
    checkThrows(
      fn: () => unknown,
      options: DoctestThrowsOptions,
    ): Extractions | Promise<Extractions>;
  }
}

function report(
  t: InstanceType<typeof TestBase>,
  { result, diagnostic = {} }: DoctestCheckResult,
): Extractions {
  (t as { currentAssert: unknown }).currentAssert = (t as { check: unknown }).check;

  if (result.pass) {
    t.pass(result.message || "");
    return result.extractions;
  }

  t.fail(result.message, {
    ...diagnostic,
    diff: result.diff,
    found: result.actual,
    wanted: result.expected,
  });
  return result.extractions;
}

TestBase.prototype.check = function tapCheck(
  actual: unknown,
  expected: string | CheckOptions | DoctestCheckOptions,
): Extractions | Promise<Extractions> {
  const check = isDoctestCheckOptions(expected) ? expected.check : expected;
  const diagnostic = isDoctestCheckOptions(expected) ? expected.diagnostic : undefined;
  const result = inspect(actual, check);

  if (result instanceof Promise) {
    return result.then((resolved) => report(this, {
      result: resolved,
      ...(diagnostic ? { diagnostic } : {}),
    }));
  }

  return report(this, { result, ...(diagnostic ? { diagnostic } : {}) });
};

/**
 * Assert that fn() throws (or, for an async fn, rejects) with an error
 * matching expected.
 * mode="name" compares just error.name; mode="full" compares "ErrorName: message".
 * On failure, includes the caught error's stack trace in diagnostics.
 *
 * A sync fn reports synchronously; a fn returning a Promise reports via a
 * returned Promise the caller must await (the doctest loader always awaits).
 */
TestBase.prototype.checkThrows = function tapCheckThrows(
  fn: () => unknown,
  { expected, mode, diagnostic }: DoctestThrowsOptions,
): Extractions | Promise<Extractions> {
  (this as { currentAssert: unknown }).currentAssert = (this as { checkThrows: unknown }).checkThrows;

  const finish = (caught: unknown, threw: boolean): Extractions => {
    let label: string;
    if (!threw) {
      label = "(no error thrown)";
    } else if (mode === "name") {
      label = caught instanceof Error ? caught.name : String(caught);
    } else {
      const name = caught instanceof Error ? caught.name : "Error";
      const msg = caught instanceof Error ? caught.message : String(caught);
      label = `${name}: ${msg}`;
    }

    const result = inspect(label, expected) as CheckResult;

    if (result.pass) {
      this.pass("");
      return result.extractions;
    }

    const extra: Record<string, unknown> = {
      ...diagnostic,
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

  let returned: unknown;
  try {
    returned = fn();
  } catch (e: unknown) {
    return finish(e, true);
  }
  if (returned instanceof Promise) {
    return returned.then(
      () => finish(null, false),
      (e: unknown) => finish(e, true),
    );
  }
  return finish(null, false);
};
