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
 *     t.checkThrows(() => badCall(), { expected: "ErrorName", mode: "name" });
 *   });
 */

import { TestBase, type Extra } from "@tapjs/core";
import { inspect, type CheckOptions, type CheckResult, type Extractions } from "./text/compare.js";
import { NO_EXPECTED, checkValue } from "../check/compare/report.js";
import type { Expected } from "../check/expected.js";

type DoctestDiagnostic = Pick<Extra, "at" | "source">;

interface DoctestCheckOptions {
  check: string | CheckOptions;
  diagnostic: DoctestDiagnostic;
}

interface DoctestThrowsOptions {
  expected: string;
  mode: "name" | "full";
  diagnostic?: DoctestDiagnostic;
  /** Test point name, as for CheckOptions.label */
  label?: string;
}

interface DoctestCheckResult {
  result: CheckResult;
  diagnostic?: DoctestDiagnostic;
  label: string | undefined;
}

function isDoctestCheckOptions(value: string | CheckOptions | DoctestCheckOptions): value is DoctestCheckOptions {
  return typeof value === "object" && "check" in value;
}

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
     * Compare `actual`'s serialized text with `expected` text, which may
     * hold `«»` wildcards. A string's trailing newlines are not compared.
     * For command output and other text; use `check` for values.
     */
    checkText(
      actual: unknown,
      expected: string | CheckOptions | DoctestCheckOptions,
    ): Extractions | Promise<Extractions>;
    /**
     * Assert that `fn` throws (or rejects). `expected` is `"Name"` to check
     * the error's name, or `"Name: message"` to check both; the message may
     * hold `«»` wildcards.
     */
    checkThrows(
      fn: () => unknown,
      expected: string | DoctestThrowsOptions,
    ): Extractions | Promise<Extractions>;
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

/** The doctest's source excerpt as a literal block, for the same reason. */
function blockSource(diagnostic: DoctestDiagnostic): Record<string, unknown> {
  return typeof diagnostic.source === "string" ? { ...diagnostic, source: literalBlock(diagnostic.source) } : diagnostic;
}

/** Failure diagnostics: hint, diff, and a paste-ready suggested value. */
function failureExtra(result: CheckResult & { pass: false }): Record<string, unknown> {
  return {
    ...(result.hint === null ? {} : { hint: literalBlock(result.hint) }),
    diff: literalBlock(result.diff),
    suggested: literalBlock(result.suggested),
  };
}

function report(
  t: InstanceType<typeof TestBase>,
  { result, diagnostic = {}, label }: DoctestCheckResult,
): Extractions {
  (t as { currentAssert: unknown }).currentAssert = (t as { checkText: unknown }).checkText;

  // A label names the test point, pass or fail ("line 42: s.toUpperCase()").
  if (result.pass) {
    t.pass(label ?? "");
    // `=> «show»`: the value is the point, so it goes into the TAP stream.
    if (result.shown !== undefined) {
      const [first = "", ...rest] = result.shown.split("\n");
      t.comment(`${label ?? "shown"} => ${first}`);
      for (const line of rest) t.comment(`  ${line}`);
    }
    return result.extractions;
  }

  t.fail(label ?? result.message, { ...blockSource(diagnostic), ...failureExtra(result) });
  return result.extractions;
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

/** A string's trailing newlines, which expected text in a doctest cannot hold, are not compared. */
function trimEnd(value: unknown): unknown {
  return typeof value === "string" ? value.replace(/\n+$/, "") : value;
}

TestBase.prototype.checkText = function tapCheckText(
  actual: unknown,
  expected: string | CheckOptions | DoctestCheckOptions,
): Extractions | Promise<Extractions> {
  const check = isDoctestCheckOptions(expected) ? expected.check : expected;
  const diagnostic = isDoctestCheckOptions(expected) ? expected.diagnostic : undefined;
  const label = typeof check === "object" ? check.label : undefined;
  const result = actual instanceof Promise
    ? actual.then((value) => inspect(trimEnd(value), check))
    : inspect(trimEnd(actual), check);

  if (result instanceof Promise) {
    return held(this, result.then((resolved) => report(this, {
      result: resolved,
      label,
      ...(diagnostic ? { diagnostic } : {}),
    })));
  }

  return report(this, { result, label, ...(diagnostic ? { diagnostic } : {}) });
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
  options: string | DoctestThrowsOptions,
): Extractions | Promise<Extractions> {
  // A plain string is the expected error: "Name" checks the name, and
  // "Name: message" checks both (as a doctest's `=> throws` line does).
  const { expected, mode, diagnostic, label: pointName }: DoctestThrowsOptions = typeof options === "string"
    ? { expected: options, mode: options.includes(": ") ? "full" : "name" }
    : options;
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
      this.pass(pointName ?? "");
      return result.extractions;
    }

    const extra: Record<string, unknown> = { ...blockSource(diagnostic ?? {}), ...failureExtra(result) };
    if (caught instanceof Error && caught.stack) {
      extra.stack = caught.stack;
    }
    this.fail(pointName ?? result.message, extra);
    return result.extractions;
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
