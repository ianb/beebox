import { outlineNeedsFocusStyle, vibeCheck } from "@ianbicking/personal-vibe-check/eslint";

export default [
  ...vibeCheck({ react: true, roots: ["src", "test"] }),
  // Opt-in Tailwind rules: dvh forms instead of 100vh, rem font sizes instead of px.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "personal-vibe-check/no-viewport-height-class": "error",
      "personal-vibe-check/no-px-font-size-class": "error",
    },
  },
  // outline-none removes the keyboard focus ring: a focus style must replace it.
  {
    files: ["src/**/*.tsx"],
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
