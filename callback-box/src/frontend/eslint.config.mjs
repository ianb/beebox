import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint";
export default [
  ...vibeCheck({ react: true }),
  {
    rules: {
      "no-optional-chaining/no-optional-chaining": "off",
      "default/no-default-params": "off",
      "max-params": ["error", 2],
      "max-lines": "off",
      "max-lines-per-function": "off",
      "no-restricted-syntax": "off",
      "single-export/single-export": "off",
      "ddd/require-spec-file": "off",
      "error/require-custom-error": "off",
      "error/no-generic-error": "off",
      "error/no-literal-error-message": "off",
    },
  },
];
