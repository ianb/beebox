import type { Linter } from "eslint";
import { disabledRules } from "./disabled-rules.ts";

// Entries that follow the main rule block in every `vibeCheck()` result,
// independent of its options. Order matters: each overrides what precedes it.
export const globalOverrides: Linter.Config[] = [
  {
    // disabledRules are rules reviewed and rejected, each with its reason.
    // The main block reaches only root-scoped files, so a package whose
    // test/ is not in its file patterns (browse, tap-check) would not get
    // them there; applied with no `files` key so every file agrees
    // (boxholder, 2026-10-18).
    rules: disabledRules,
  },
  {
    // The error/* rules are off in tests — boxholder decision 2026-10-18.
    // A test throws a plain Error on purpose: as the input the code under
    // test receives, from a fake that simulates a failure or must not be
    // called, or as a guard that narrows setup. A custom error class for
    // each adds nothing; converted tests had 297 such lines.
    //
    // max-lines is 600 in tests, not 300 — boxholder decision 2026-10-18:
    // a test file holds a setup and many examples, so it runs longer than
    // the module it tests, though past some length it still needs a split.
    // Of 1,094 converted tests, 73 were over 300 lines and 8 over 600.
    files: ["**/test/**/*.{ts,tsx}", "**/*.test.{ts,tsx}"],
    rules: {
      "error/no-generic-error": "off",
      "error/require-custom-error": "off",
      "error/no-literal-error-message": "off",
      "max-lines": ["error", { max: 600, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // Type-aware rules. projectService builds a TS program per project,
    // which adds roughly 1.5s to a single-file lint run (the per-edit hook)
    // and ~2s to a full-tree run — keep this entry small. Scoped to src/
    // TS files only: type info needs the file to be in the project's
    // tsconfig, and .js shims have no type info.
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { projectService: true },
    },
    rules: {
      // Don't throw non-Error values — ensures stack traces are always
      // available. Bans literals, plain objects, and anything not typed as
      // Error (including non-Error class instances and calls returning
      // non-Error, which the old syntactic rule missed), while allowing
      // `throw e` rethrows of caught values — narrow handling like
      // `catch (e) { if (!(e instanceof RangeError)) throw e; ... }` is
      // the style we want, not catch-everything fallbacks.
      "@typescript-eslint/only-throw-error": [
        "error",
        {
          allowRethrowing: true,
          allowThrowingAny: false,
          allowThrowingUnknown: false,
        },
      ],
      // Every switch over a closed union must handle every member — a new
      // member makes the switch fail to compile until it's handled. Config
      // per the exhaustiveness research (issues #10307, #3616):
      //   considerDefaultExhaustiveForUnions: false — a bare `default:` does
      //     NOT count as exhaustive, so unions must list every case (the
      //     load-bearing option; `default: assertNever(x)` is the blessed
      //     terminator, still legal via allowDefaultCaseForExhaustiveSwitch).
      //   requireDefaultForNonUnion: true — switches over `number`/`string`
      //     must carry a `default:` (they can't be proven exhaustive).
      //   allowDefaultCaseForExhaustiveSwitch: true — keeps
      //     `default: assertNever(x)` on an already-exhaustive union legal.
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        {
          considerDefaultExhaustiveForUnions: false,
          requireDefaultForNonUnion: true,
          allowDefaultCaseForExhaustiveSwitch: true,
        },
      ],
      // A Promise that's neither awaited, returned, `.then()`-chained, nor
      // explicitly voided is a bug waiting to happen: unhandled rejections
      // crash the process (Node) or vanish silently, and sequencing bugs
      // (fire-and-forget where the caller assumed ordering) hide behind a
      // clean-looking call. `void expr` is still the escape hatch for
      // genuine fire-and-forget, but it's opt-in per call site, not the
      // default for every promise-returning expression.
      "@typescript-eslint/no-floating-promises": "error",
      // Passing an async function where a sync callback is expected (Array
      // .forEach, a sync event-handler prop, a non-Promise-returning
      // interface member) silently drops the returned promise and any
      // rejection inside it — the same failure mode as no-floating-promises
      // but at the wiring level instead of the call level. Defaults (no
      // options) flag all four categories: arguments, void-return-typed
      // functions passed as attributes/handlers, inherited method mismatch,
      // and conditionals like `if (asyncFn())`.
      "@typescript-eslint/no-misused-promises": "error",
      // `return await x` inside a try/catch (or a `using`/`await using`
      // scope) is not redundant: dropping the `await` lets the returned
      // promise reject *after* the try block (or resource disposal) has
      // already exited, so the rejection is attributed to the wrong frame
      // and any `finally`/`using` cleanup that should run before the
      // rejection propagates doesn't. Default (`in-try-catch`) mode
      // requires `await` on returns inside try/catch/using scopes and
      // disallows the redundant `await` on a bare tail-return elsewhere.
      // Measured fallout in one consumer: most hits were Fastify route
      // handlers (`return reply.send(...)` inside a try whose catch
      // re-sends) where forcing `await` routes a rejected send into the
      // catch block and causes a second send (FST_ERR_REP_ALREADY_SENT).
      // Consuming projects with a route-handler directory matching this
      // shape should disable the rule there in their OWN eslint config
      // (see beebox/eslint.config.ts for the model), not here —
      // this preset has no opinion on any one project's route layout.
      "@typescript-eslint/return-await": "error",
      // `x!` silences the compiler instead of proving non-null; a wrong
      // assertion becomes a runtime crash with no type-checker warning.
      // Burned down 2026-07-10: 190 sites converted to real narrowing
      // (optional chaining, explicit guards, or a typed assertion helper)
      // across beebox (backend + frontend), beebox-clerk, and
      // tap-check.
      "@typescript-eslint/no-non-null-assertion": "error",
      // Flags conditions/optional-chains/binary-expressions that TypeScript's
      // types prove can never be false (or never true) — usually a stale
      // guard left over after a type narrowed, or a check that was never
      // reachable to begin with. Burned down 2026-07-10: ~200 sites fixed
      // across beebox (backend + frontend), beebox-clerk, and
      // tap-check; 3 sites kept a justified single-line disable comment
      // (tap-check's text compare and
      // beebox frontend useSSRMachine.ts, router.tsx) where the
      // condition is genuinely defensive against a case the type system
      // can't see (e.g. a cast at a parse/runtime boundary).
      "@typescript-eslint/no-unnecessary-condition": "error",
    },
  },
];
