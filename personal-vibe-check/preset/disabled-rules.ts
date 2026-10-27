import type { Linter } from "eslint";

// ── Disabled rules ─────────────────────────────────────────────────
// Rules reviewed and rejected. Each has a comment explaining why.
export const disabledRules: Linter.RulesRecord = {
  // Redundant with TypeScript — TS already catches undeclared variables
  "no-undef": "off",
  // Superseded by @typescript-eslint/no-unused-vars which understands TS
  "no-unused-vars": "off",
  // Non-literal filenames are common in apps
  "security/detect-non-literal-fs-filename": "off",
  // Flags all obj[variable] bracket access — too many false positives
  "security/detect-object-injection": "off",
  // ReDoS risk is negligible in most apps
  "security/detect-unsafe-regex": "off",
};
