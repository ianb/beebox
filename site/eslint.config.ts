import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint";

export default [
  // roots: ["."] — the generator's sources live at the package root (build.ts,
  // render.ts, links.ts), not under src/, so point the reviewed .ts ruleset at
  // the root. Without this they'd fall through to eslint-config-agent's stricter
  // base profile (max-lines 100, `??` banned) meant for .tsx.
  ...vibeCheck({ react: false, roots: ["."], ignores: ["**/*.mjs", "dist/**", "node_modules/**"] }),
  {
    rules: {
      "max-params": ["error", 2],
      "error/require-custom-error": "off",
      "error/no-generic-error": "off",
      "error/no-literal-error-message": "off",
      "error/no-throw-literal": "off",
      "security/detect-non-literal-fs-filename": "off",
      "default/no-hardcoded-urls": "off",
      "single-export/single-export": "off",
      "ddd/require-spec-file": "off",
    },
  },
];
