import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint";

export default [
  ...vibeCheck({
    react: false,
    roots: ["src/server", "src/shared", "test"],
    ignores: ["src/frontend/**"],
  }),
];
