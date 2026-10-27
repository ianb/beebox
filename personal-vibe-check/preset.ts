import type { Linter } from "eslint";
import type { VibeCheckOptions, vibeCheck as DeclaredVibeCheck } from "./types";
import { baseConfig } from "./preset/base-config.ts";
import { disabledRules } from "./preset/disabled-rules.ts";
import { enabledRules } from "./preset/enabled-rules.ts";
import { globalOverrides } from "./preset/global-overrides.ts";
import { mainPlugins } from "./preset/main-plugins.ts";
import { reactRules } from "./preset/react-rules.ts";
import { tsxOverride } from "./preset/tsx-overrides.ts";

// The rule choices and their rationale comments live in `preset/`, one module
// per concern: `enabled-rules.ts` and `disabled-rules.ts` (reviewed and
// accepted / rejected), `react-rules.ts`, `global-overrides.ts` (retirements,
// test-file budgets, type-aware rules), and `tsx-overrides.ts` (react:false
// `.tsx`). This file only assembles them in order.

/**
 * Returns a flat ESLint config array.
 *
 * The options are documented on `VibeCheckOptions` in `types.d.ts`, which is
 * also what consumers resolve as this module's types — see the note there for
 * why the declaration is separate from this source.
 */
export function vibeCheck(options?: VibeCheckOptions): Linter.Config[] {
  const react = options?.react;
  const extraIgnores = options?.ignores ?? [];
  const roots = options?.roots ?? ["src"];
  const restrictClassesOptions = options?.restrictComponentClasses ?? null;

  const exts = "{ts,tsx,js,jsx}";
  const filePatterns = roots.map((r) => `${r}/**/*.${exts}`);

  return [
    ...baseConfig,
    {
      ignores: ["node_modules/**", "dist/**", "build/**", "out/**", "*.mjs", ...extraIgnores],
    },
    {
      files: filePatterns,
      plugins: mainPlugins(react),
      settings: react ? { react: { version: "detect" } } : {},
      rules: {
        ...enabledRules,
        ...(react ? reactRules : {}),
        ...disabledRules,
        ...(restrictClassesOptions !== null
          ? { "personal-vibe-check/restrict-component-classes": ["error", restrictClassesOptions] }
          : {}),
      },
    },
    ...globalOverrides,
    // react:false `.tsx` overrides; see tsx-overrides.ts.
    ...(react ? [] : [tsxOverride]),
  ];
}

// Default export for backward compatibility
export default vibeCheck;

// Binds the implementation to the published declaration in types.d.ts (what the
// exports map's `types` condition serves), in BOTH directions. One assignment
// alone would only prove the implementation is *assignable to* the declaration,
// which tolerates real divergence — a narrower return type, or extra optional
// parameters, passes a one-way check. Mutual assignability is as close to
// "these are the same function type" as TypeScript expresses, and it is what
// makes a signature change here fail this package's own `pnpm typecheck` unless
// types.d.ts moves with it.
//
// The options object cannot drift at all: `VibeCheckOptions` is imported FROM
// types.d.ts rather than restated here, so there is only one definition.
// Parameters/ReturnType rather than the function types directly: TypeScript's
// function assignability ignores an extra trailing OPTIONAL parameter in both
// directions, so comparing `typeof vibeCheck` to `typeof DeclaredVibeCheck`
// would let one side grow an option the other never declares. Comparing the
// parameter tuples closes that — tuples of different arity are not mutually
// assignable.
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _parametersMatch: MutuallyAssignable<
  Parameters<typeof vibeCheck>,
  Parameters<typeof DeclaredVibeCheck>
> = true;
const _returnTypeMatches: MutuallyAssignable<
  ReturnType<typeof vibeCheck>,
  ReturnType<typeof DeclaredVibeCheck>
> = true;
