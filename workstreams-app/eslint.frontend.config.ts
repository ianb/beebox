import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint";

export default [
  ...vibeCheck({
    react: true,
    roots: ["src/frontend"],
  }),
  // 100vh overshoots on mobile Safari: use the dvh forms. Opt-in rule (Tailwind-specific).
  {
    files: ["src/frontend/**/*.{ts,tsx}"],
    rules: { "personal-vibe-check/no-viewport-height-class": "error" },
  },
];
