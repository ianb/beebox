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
  // Outside any components/ subdirectory: every JSX element's className must
  // be outer-layout classes only (margin, padding, flex/grid item, sizing,
  // position). Keeps page-level code (renderers, app-shell, routes) from
  // smuggling appearance in via <div className="bg-plum shadow">. Files
  // inside components/ are exempt — that is where appearance lives.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["**/components/**"],
    rules: {
      "personal-vibe-check/restrict-component-classes": ["error", { matchAll: true }],
    },
  },
];
