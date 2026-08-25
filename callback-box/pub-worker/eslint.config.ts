import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint";

export default [
  ...vibeCheck({ react: false, ignores: ["**/*.mjs", "vitest.config.ts"] }),
  {
    rules: {
      // `ddd/require-spec-file` and `single-export/single-export` encode
      // callback-box's box-architecture conventions (a colocated .spec per
      // module, one export per file); the Worker package is a small, flat CF
      // bundle whose tests live under test/, so these don't apply here — same
      // stance the sibling agent-doctest package takes.
      "ddd/require-spec-file": "off",
      "single-export/single-export": "off",
    },
  },
];
