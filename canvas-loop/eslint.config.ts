import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint";
// Self-host the TEA plugin through the package's own "./eslint" export (the
// exports map, not a relative path) — proving the subpath resolves.
import teaPlugin from "@ianbicking/canvas-loop/eslint";

// Full strict preset, no per-project rule loosening. `roots` holds examples/
// and test/ to the same reviewed ruleset as src/ (the type-aware block inside
// the preset stays src-only, since it needs tsconfig project membership).
// `react: true` because the `./react` subpath (src/react/) and the dev-demo/
// bundle are .tsx — the React/JSX/hooks rules ADD to the preset and are inert
// on the package's non-JSX .ts files (they key off components/hooks/JSX).
const base = vibeCheck({
  react: true,
  roots: ["src", "test"],
  ignores: ["**/*.mjs", "out/**", "src/gallery/out/**", "src/browser/dist/**"],
});

// The TEA discipline (see TEA.md) applies to TEA sketches only. The mutable and
// TEA tiers share examples/ and gallery/, so the discipline keys off the
// `*-tea.ts` filename convention — a mutable sketch (module-level `let`, direct
// mutation) is left untouched. `configs.recommended` bundles the tea/* rules and
// the no-restricted-imports framework restriction; it only ADDS rules on top of
// the preset — it never redefines a preset rule, so nothing is weakened.
const teaSketches = teaPlugin.configs.recommended;

// Type-aware exhaustiveness on the Msg switch — Elm's exhaustive `case` parity.
// Kept out of `configs.recommended` because it needs tsconfig project membership
// (gallery/ added to tsconfig include); wired in here on the same file glob.
const teaExhaustiveness = {
  files: ["src/examples/**/*-tea.ts", "src/gallery/**/*-tea.ts"],
  languageOptions: { parserOptions: { projectService: true } },
  rules: {
    "@typescript-eslint/switch-exhaustiveness-check": [
      "error",
      {
        considerDefaultExhaustiveForUnions: false,
        requireDefaultForNonUnion: true,
        allowDefaultCaseForExhaustiveSwitch: true,
      },
    ],
  },
};

// Boxholder-authorized loosening for sketches only (src/examples, src/gallery).
// 2026-07-14: sketches carry declarative scene data (palettes, layer configs,
// creature geometry) that the preset's library-code cap of 300 punishes.
// 2026-11-11: a sketch is a drawing iterated in short render cycles, not
// long-lived library code; the brush round-1 drawers each rewrote working
// helpers to satisfy these rules before their first render. Relaxed are the
// rules they hit: positional/default params, function length, `1.0` literals,
// plain `Error`, and in-place `reverse()`. Unused-variable and type rules stay.
const sketchLineBudget = {
  files: ["src/examples/**/*.ts", "src/gallery/**/*.ts"],
  rules: {
    "max-lines": ["error", { max: 600, skipBlankLines: true, skipComments: true }],
    "max-params": "off",
    "default/no-default-params": "off",
    "max-lines-per-function": "off",
    "unicorn/no-zero-fractions": "off",
    "error/no-generic-error": "off",
    "error/require-custom-error": "off",
    "error/no-literal-error-message": "off",
    "unicorn/no-array-reverse": "off",
  },
};

export default [...base, teaSketches, teaExhaustiveness, sketchLineBudget];
