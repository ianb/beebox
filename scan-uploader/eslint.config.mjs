import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint";

// Full strict preset, no rule loosening. `roots` holds test/ and build.ts to
// the same reviewed ruleset as src/ (per the monorepo convention that test
// code isn't a lint-free zone).
export default [
  ...vibeCheck({ react: false, roots: ["src", "test"], ignores: ["dist/**"] }),
];
