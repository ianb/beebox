import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint";

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
  // `hover:` and a bare `ring-*` do not count.
  {
    files: ["src/**/*.tsx"],
    rules: {
      "personal-vibe-check/restricted-classes": [
        "error",
        {
          entries: [
            {
              all: ["outline-none|focus:outline-none|focus-visible:outline-none"],
              none: [
                "focus:ring-*|focus-visible:ring-*|focus-within:ring-*",
                "focus:border-*|focus-visible:border-*",
                "focus:shadow-*|focus-visible:shadow-*",
                "focus:outline-*!focus:outline-none|focus-visible:outline-*!focus-visible:outline-none",
              ],
              message: "outline-none removes the keyboard focus ring: add focus-visible:ring-*, a border, shadow or outline.",
            },
          ],
        },
      ],
    },
  },
];
