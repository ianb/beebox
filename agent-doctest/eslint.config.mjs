import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint";
export default [
  ...vibeCheck({ react: false, ignores: ["**/*.mjs"] }),
  {
    rules: {
      "no-optional-chaining/no-optional-chaining": "off",
      "default/no-default-params": "off",
      "max-params": ["error", 2],
      "max-lines": "off",
      "max-lines-per-function": "off",
      "error/require-custom-error": "off",
      "error/no-generic-error": "off",
      "error/no-literal-error-message": "off",
      "error/no-throw-literal": "off",
      "security/detect-non-literal-regexp": "off",
      "security/detect-object-injection": "off",
      "security/detect-bidi-characters": "off",
      "default/no-hardcoded-urls": "off",
      "custom/jsx-classname-required": "off",
      "no-restricted-syntax": "off",
      "complexity": "off",
      "@typescript-eslint/no-this-alias": "off",
      "single-export/single-export": "off",
      "ddd/require-spec-file": "off",
    },
  },
];
