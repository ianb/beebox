import { outlineNeedsFocusStyle, vibeCheck } from "@ianbicking/personal-vibe-check/eslint";

export default [
  ...vibeCheck({
    react: true,
    roots: ["src/frontend"],
  }),
  // 100vh overshoots on mobile Safari: use the dvh forms. Opt-in rules (Tailwind-specific).
  {
    files: ["src/frontend/**/*.{ts,tsx}"],
    rules: {
      "personal-vibe-check/no-viewport-height-class": "error",
      "personal-vibe-check/no-px-font-size-class": "error",
    },
  },
  // outline-none removes the keyboard focus ring: a focus style must replace it.
  {
    files: ["src/frontend/**/*.tsx"],
    rules: {
      "personal-vibe-check/restricted-classes": [
        "error",
        {
          entries: [outlineNeedsFocusStyle],
        },
      ],
    },
  },
];
