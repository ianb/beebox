/**
 * Tap integration: `t.check`, `t.checkText`, and `t.checkThrows`.
 *
 * Adds the methods to all tap tests via prototype patching. Loaded
 * automatically via `--import` in .taprc node-arg.
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
 *     t.checkText(output, "total: «int»");
 *     t.checkThrows(() => badCall(), "ErrorName: bad «*»");
 *   });
 */

import { TestBase } from "@tapjs/core";
import { compareText, type TextComparison } from "./text/compare.js";
import { NO_EXPECTED, checkValue } from "../check/compare/report.js";
import type { Expected } from "../check/expected.js";

/** A promise of the result when `actual` is promise-like; the result itself otherwise. */
type Settled<T, R> = T extends PromiseLike<unknown> ? Promise<R> : R;

/** A promise or other thenable: its value is awaited before it is checked. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

declare module "@tapjs/core" {
  interface TestBase {
    /**
     * Compare the whole of `actual` with `expected`. Matching is exact: an
     * extra, missing, or different key fails. Patterns (`any(String)`,
     * `uuid()`, `[others]`, ...) stand in for values that vary;
     * `capture(pattern)` keeps the matched value for a later check.
     *
     * With no `expected`, the check fails and prints a suggested value.
     */
    // NoInfer: `T` comes from `actual` alone. Inferring it from `expected` too
    // would widen it to fit a wrong expected value instead of reporting it.
    check<T>(actual: T, expected?: NoInfer<Expected<Awaited<T>>>): Settled<T, void>;
    /**
     * Compare the text `actual` with `expected` text, which may hold `«»`
     * wildcards. Trailing newlines in `actual` are not compared. For command
     * output and other text; use `check` for values.
     */
    checkText(actual: string | PromiseLike<string>, expected: string): void | Promise<void>;
    /**
     * Assert that `fn` throws (or rejects). `expected` is `"Name"` to check
     * the error's name, or `"Name: message"` to check both; the message may
     * hold `«»` wildcards.
     */
    checkThrows(fn: () => unknown, expected: string): void | Promise<void>;
  }
}

/**
 * A string as a YAML literal block (`|-`). tap's YAML writer otherwise picks
 * a folded block (`>-`) once any line passes 80 columns, which doubles every
 * newline and re-wraps long lines, and it quotes a one-line value that looks
 * like a number or boolean (`"2"`). Either way the text is no longer
 * paste-ready. `yaml` identifies nodes by these registry symbols
 * (`Symbol.for`), so this plain object is read as a Scalar without importing
 * the `yaml` package.
 */
function literalBlock(text: string): unknown {
  return { [Symbol.for("yaml.node.type")]: Symbol.for("yaml.scalar"), value: text, type: "BLOCK_LITERAL" };
}

/** Failure diagnostics: hint, diff, and a paste-ready suggested value. */
function failureExtra(result: TextComparison & { pass: false }): Record<string, unknown> {
  return {
    ...(result.hint === null ? {} : { hint: literalBlock(result.hint) }),
    diff: literalBlock(result.diff),
    suggested: literalBlock(result.suggested),
  };
}

TestBase.prototype.check = function tapCheckValue(this: InstanceType<typeof TestBase>, ...args: unknown[]): unknown {
  const [actual, ...rest] = args;
  const expected = rest.length === 0 ? NO_EXPECTED : rest[0];
  const run = (value: unknown): void => {
    (this as { currentAssert: unknown }).currentAssert = (this as { check: unknown }).check;
    const outcome = checkValue(value, expected);
    if (outcome.pass) {
      this.pass("");
      return;
    }
    const extra: Record<string, unknown> = {};
    if (outcome.mismatches !== undefined) extra.mismatches = literalBlock(outcome.mismatches);
    if (outcome.diff !== undefined) extra.diff = literalBlock(outcome.diff);
    extra.suggested = literalBlock(outcome.suggested);
    if (outcome.generalized !== undefined) extra.generalized = literalBlock(outcome.generalized);
    this.fail(outcome.message, extra);
  };
  return isThenable(actual) ? held(this, Promise.resolve(actual).then(run)) : run(actual);
} as TestBase["check"];

/**
 * Keep the test open until a check's promise settles, even when the caller
 * forgot to await it: otherwise the check could run after the test ended
 * and its failure would be lost. Lint cannot catch the missing `await` in
 * tests (the type-aware rules cover src/ only). The test waits on a copy
 * that never rejects; the returned promise still rejects for the caller.
 */
function ignore(): void {
  // A settled outcome is all the waiter needs.
}

function held<T>(t: TestBase, promise: Promise<T>): Promise<T> {
  const settled: Promise<void> = promise.then(ignore, ignore);
  void t.waitOn(settled);
  return promise;
}

/** A string's trailing newlines are not compared: command output and files end with one, and expected text rarely does. */
function trimEnd(value: string): string {
  return value.replace(/\n+$/, "");
}

TestBase.prototype.checkText = function tapCheckText(
  this: InstanceType<typeof TestBase>,
  ...[actual, expected]: Parameters<TestBase["checkText"]>
): void | Promise<void> {
  const run = (text: string): void => {
    (this as { currentAssert: unknown }).currentAssert = (this as { checkText: unknown }).checkText;
    const result = compareText(trimEnd(text), expected);
    if (result.pass) this.pass("");
    else this.fail("check failed", failureExtra(result));
  };
  return isThenable(actual) ? held(this, Promise.resolve(actual).then(run)) : run(actual);
};

/**
 * Assert that fn() throws (or, for an async fn, rejects) with an error
 * matching expected: "Name" compares just error.name; "Name: message"
 * compares both. On failure, includes the caught error's stack trace in
 * diagnostics.
 *
 * A sync fn reports synchronously; a fn returning a Promise reports via a
 * returned Promise the caller must await.
 */
TestBase.prototype.checkThrows = function tapCheckThrows(
  this: InstanceType<typeof TestBase>,
  ...[fn, expected]: Parameters<TestBase["checkThrows"]>
): void | Promise<void> {
  const full = expected.includes(": ");
  (this as { currentAssert: unknown }).currentAssert = (this as { checkThrows: unknown }).checkThrows;

  const finish = (caught: unknown, threw: boolean): void => {
    let described: string;
    if (!threw) {
      described = "(no error thrown)";
    } else if (!full) {
      described = caught instanceof Error ? caught.name : String(caught);
    } else {
      const name = caught instanceof Error ? caught.name : "Error";
      const msg = caught instanceof Error ? caught.message : String(caught);
      described = `${name}: ${msg}`;
    }

    const result = compareText(described, expected);
    if (result.pass) {
      this.pass("");
      return;
    }
    const extra = failureExtra(result);
    if (caught instanceof Error && caught.stack) extra.stack = caught.stack;
    this.fail("check failed", extra);
  };

  let returned: unknown;
  try {
    returned = fn();
  } catch (e: unknown) {
    return finish(e, true);
  }
  if (isThenable(returned)) {
    return held(this, Promise.resolve(returned).then(
      () => finish(null, false),
      (e: unknown) => finish(e, true),
    ));
  }
  return finish(null, false);
};
