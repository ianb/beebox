import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint";
import teaPlugin from "./tea-lint.mjs";

// Full strict preset, no per-project rule loosening. `roots` holds examples/
// and test/ to the same reviewed ruleset as src/ (the type-aware block inside
// the preset stays src-only, since it needs tsconfig project membership).
const base = vibeCheck({
  react: false,
  roots: ["src", "examples", "experiments", "test"],
  ignores: ["**/*.mjs", "out/**", "experiments/out/**"],
});

// The TEA discipline (see TEA.md) applies to TEA sketches only. The mutable and
// TEA tiers share examples/ and experiments/, so the discipline keys off the
// `*-tea.ts` filename convention — a mutable sketch (module-level `let`, direct
// mutation) is left untouched. These blocks ADD rules on top of the preset —
// they never redefine a preset rule, so nothing is weakened.
const SKETCH_DIRS = ["examples/**/*-tea.ts", "experiments/**/*-tea.ts"];

const teaDiscipline = {
  files: SKETCH_DIRS,
  plugins: { tea: teaPlugin },
  rules: {
    "tea/no-module-state": "error",
    "tea/no-model-mutation": "error",
    "tea/no-async-sketch": "error",
    "tea/no-classes": "error",
    // Sketches may import ONLY the canvas-loop framework type modules. Bans npm
    // packages, node builtins, and reaching into other framework internals —
    // the sketch's whole world arrives through Msg/Util/View.
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            regex: "^(?!\\.\\./src/(tea|sketch|types)\\.js$).+",
            message: "Sketches may import only the canvas-loop framework types (../src/tea.js).",
          },
        ],
      },
    ],
  },
};

// Type-aware exhaustiveness on the Msg switch — Elm's exhaustive `case` parity.
// Needs tsconfig project membership (experiments/ added to tsconfig include).
const teaExhaustiveness = {
  files: SKETCH_DIRS,
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

export default [...base, teaDiscipline, teaExhaustiveness];
