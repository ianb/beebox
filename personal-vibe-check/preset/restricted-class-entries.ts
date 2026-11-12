import type { RestrictedClassesEntry } from "../types";

// Shared `restricted-classes` entries, exported from `@ianbicking/personal-vibe-check/eslint`
// so every package that opts in uses one definition. Documented in `types.d.ts`.

export const outlineNeedsFocusStyle: RestrictedClassesEntry = {
  all: ["outline-none|focus:outline-none|focus-visible:outline-none"],
  none: [
    "focus:ring-*|focus-visible:ring-*|focus-within:ring-*",
    "focus:border-*|focus-visible:border-*",
    "focus:shadow-*|focus-visible:shadow-*",
    "focus:outline-*!focus:outline-none|focus-visible:outline-*!focus-visible:outline-none",
  ],
  message: "outline-none removes the keyboard focus ring: add focus-visible:ring-*, a border, shadow or outline.",
};
