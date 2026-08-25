/**
 * The public type surface of `@ianbicking/personal-vibe-check/eslint`.
 *
 * The `exports` map points the `types` condition here rather than at
 * `eslint.config.ts` directly, and that indirection is deliberate. TypeScript
 * WILL resolve a `.ts` source file through an exports map — but then it pulls
 * that source into every consumer's program, type-checked under whichever
 * tsconfig that consumer happens to have. Ten packages here disagree about
 * `exactOptionalPropertyTypes`, module resolution, and `lib`, and several of the
 * plugins this preset imports (`eslint-config-agent`, `eslint-plugin-ddd`,
 * `eslint-plugin-jsx-a11y`) ship no types at all, so `noImplicitAny` consumers
 * would inherit TS7016 errors from a file they don't own. A `.d.ts` is covered
 * by `skipLibCheck`, so consumers get the contract and nothing else.
 *
 * `preset.ts` asserts that its implementation's parameter tuple and return type
 * are mutually assignable with this declaration's, and imports
 * `VibeCheckOptions` from here rather than restating it. So a signature change
 * that is not mirrored here fails this package's own `pnpm typecheck`. (Both
 * halves of that are needed: a one-way assignment tolerates a narrower return
 * type, and comparing the function types directly tolerates an extra trailing
 * optional parameter on either side.)
 */

import type { Linter } from "eslint";

/** Options for the `restrict-component-classes` rule. Mirrors its `meta.schema`. */
export interface RestrictComponentClassesOptions {
  /**
   * Glob patterns matched against the `from "..."` source of imports that bring
   * in a UI component. Ignored when `matchAll` is true.
   */
  components?: string[];
  /**
   * Check every JSX element in the file regardless of import source. Default
   * false; when true, `components` is ignored.
   */
  matchAll?: boolean;
  /** Prop names to validate. Default: `["className"]`. */
  props?: string[];
  /**
   * Regex sources for allowed token shapes. Omit to use the built-in layout
   * allowlist.
   */
  allowedPatterns?: string[];
}

export interface VibeCheckOptions {
  /** Include React/JSX rules. Default false. */
  react?: boolean;
  /** Additional ignore patterns, appended to the preset's own. */
  ignores?: string[];
  /**
   * Source roots the reviewed ruleset applies to. Default `["src"]`. Add e.g.
   * `"scripts"` to hold first-party tooling outside `src/` to the same rules
   * instead of eslint-config-agent's harsher global base. Only affects the main
   * (non-type-aware) rule block; the type-aware scope stays src-only since it
   * needs tsconfig project membership.
   */
  roots?: string[];
  /**
   * Enable the `restrict-component-classes` rule with these options. Omit to
   * leave the rule disabled.
   */
  restrictComponentClasses?: RestrictComponentClassesOptions;
}

/** Returns a flat ESLint config array. */
export declare function vibeCheck(options?: VibeCheckOptions): Linter.Config[];

export default vibeCheck;
