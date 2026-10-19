// This package's own lint config.
//
// The preset it exports lives in `preset.ts`, deliberately NOT in a file named
// `eslint.config.*`: `vibeCheck` is a factory, and ESLint refuses a config
// whose default export is a function ("TypeError: Unexpected function"). While
// the preset sat at `eslint.config.mjs`, ESLint picked IT up as this package's
// config and crashed, which is why personal-vibe-check was the one package that
// never linted itself (issues/closed/code-quality/2026-07-29-personal-vibe-check-no-self-lint.md).
//
// `roots: ["."]` because this package's sources are at its root, not under src/.
import { vibeCheck } from "./preset.ts";

export default [
  ...vibeCheck({
    react: false,
    roots: ["."],
    ignores: ["node_modules/**", "hooks/**"],
  }),
];

