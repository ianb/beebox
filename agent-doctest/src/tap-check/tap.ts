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
 *     t.checkThrows(() => badCall(), { expected: "ErrorName", mode: "name" });
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
  (t as { currentAssert: unknown }).currentAssert = (t as { check: unknown }).check;

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

TestBase.prototype.check = function tapCheck(
  actual: unknown,
  expected: string | CheckOptions | DoctestCheckOptions,
): Extractions | Promise<Extractions> {
  const check = isDoctestCheckOptions(expected) ? expected.check : expected;
  const diagnostic = isDoctestCheckOptions(expected) ? expected.diagnostic : undefined;
  const label = typeof check === "object" ? check.label : undefined;
  const result = inspect(actual, check);

  if (result instanceof Promise) {
    return result.then((resolved) => report(this, {
      result: resolved,
      label,
      ...(diagnostic ? { diagnostic } : {}),
    }));
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
  { expected, mode, diagnostic, label: pointName }: DoctestThrowsOptions,
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
  if (returned instanceof Promise) {
    return returned.then(
      () => finish(null, false),
      (e: unknown) => finish(e, true),
    );
  }
  return finish(null, false);
};
