import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint";

// Full strict preset, no per-project rule loosening. `roots` holds examples/
// and test/ to the same reviewed ruleset as src/ (the type-aware block inside
// the preset stays src-only, since it needs tsconfig project membership).
export default vibeCheck({
  react: false,
  roots: ["src", "examples", "test"],
  ignores: ["**/*.mjs", "out/**"],
});
