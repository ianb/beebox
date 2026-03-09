/**
 * Tap integration for check().
 *
 * Adds t.check() to all tap tests via prototype patching.
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
 *   });
 */

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { inspect, type CheckOptions, type CheckResult, type Extractions } from "./check.js";

// Resolve @tapjs/core via CJS resolution from CWD (gives us the file path),
// then import it as ESM. This ensures we patch the same TestBase instance
// that tap uses, even when agent-doctest has its own node_modules.
const cwdRequire = createRequire(process.cwd() + "/");
const corePath = cwdRequire.resolve("@tapjs/core");
// Convert CJS path to ESM path (commonjs → esm)
const esmPath = corePath.replace("/dist/commonjs/", "/dist/esm/");
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const core: typeof import("@tapjs/core") = await import(pathToFileURL(esmPath).href);
const { TestBase } = core;

declare module "@tapjs/core" {
  interface TestBase {
    check(
      actual: unknown,
      expected: string | CheckOptions,
    ): Extractions | Promise<Extractions>;
  }
}

function report(t: InstanceType<typeof TestBase>, result: CheckResult): Extractions {
  (t as { currentAssert: unknown }).currentAssert = (t as { check: unknown }).check;

  if (result.pass) {
    t.pass(result.message || "check passed");
    return result.extractions;
  }

  t.fail(result.message, {
    diff: result.diff!,
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
