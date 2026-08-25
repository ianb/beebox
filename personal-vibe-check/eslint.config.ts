// This package's own lint config.
//
// The preset it exports lives in `preset.ts`, deliberately NOT in a file named
// `eslint.config.*`: `vibeCheck` is a factory, and ESLint refuses a config
// whose default export is a function ("TypeError: Unexpected function"). While
// the preset sat at `eslint.config.mjs`, ESLint picked IT up as this package's
// config and crashed, which is why personal-vibe-check was the one package that
// never linted itself (issues/code-quality/2026-07-29-personal-vibe-check-no-self-lint.md).
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

// Deliberately NOT wired to a `lint` script yet. With the config in place,
// `pnpm exec eslint .` reports 6 remaining violations, all of them pre-existing
// structure rather than anything the TypeScript conversion introduced:
// preset.ts is 461 code lines against `max-lines: 300`, `vibeCheck` is 218
// against `max-lines-per-function: 150`, and four plugin imports trip
// `import-x/no-rename-default`. Splitting the preset is its own change; adding a
// `lint` script before that would just break the monorepo's recursive
// `pnpm lint`. See issues/code-quality/2026-07-29-personal-vibe-check-no-self-lint.md,
// whose structural blocker (the preset living at `eslint.config.mjs`) this
// change removed.
