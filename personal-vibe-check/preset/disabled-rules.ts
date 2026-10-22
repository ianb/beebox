import type { Linter } from "eslint";

// ── Disabled rules ─────────────────────────────────────────────────
// Rules reviewed and rejected. Each has a comment explaining why.
export const disabledRules: Linter.RulesRecord = {
  // Redundant with TypeScript — TS already catches undeclared variables
  "no-undef": "off",
  // Superseded by @typescript-eslint/no-unused-vars which understands TS
  "no-unused-vars": "off",
  // Namespace imports (import * as) are fine
  "import/no-namespace": "off",
  // Pure style rule — not worth the churn
  "import/order": "off",
  // Non-literal filenames are common in apps
  "security/detect-non-literal-fs-filename": "off",
  // Flags all obj[variable] bracket access — too many false positives
  "security/detect-object-injection": "off",
  // ReDoS risk is negligible in most apps
  "security/detect-unsafe-regex": "off",
  // Broken eslint-import-resolver-typescript setup
  "import/no-extraneous-dependencies": "off",
  // Requires className on every JSX element — nonsensical
  "custom/jsx-classname-required": "off",
  // Every file needs a test file — not everyone's testing strategy
  "ddd/require-spec-file": "off",
  // Bans URLs in code — API endpoints and config URLs are fine
  "default/no-hardcoded-urls": "off",
  // Bans localhost — dev servers use it
  "default/no-localhost": "off",
  // Forces internal classes to be exported
  "class-export/class-export": "off",
  "required-exports/required-exports": "off",
};
