import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint";
export default [
  ...vibeCheck({ react: false }),
  {
    rules: {
      "no-optional-chaining/no-optional-chaining": "off",
      "default/no-default-params": "off",
      "max-params": ["error", 2],
      "security/detect-non-literal-regexp": "off",
      "max-lines": "off",
      "max-lines-per-function": "off",
      "error/no-literal-error-message": "off",
      "error/require-custom-error": "off",
      "error/no-generic-error": "off",
      "no-restricted-syntax": "off",
      "single-export/single-export": "off",
      "ddd/require-spec-file": "off",
    },
  },
];
