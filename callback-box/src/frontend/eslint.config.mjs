// ⚠️ DO NOT disable or turn "off" any lint rule here without very clear and
// explicit permission from the user. Every rule in personal-vibe-check is a
// deliberate choice. Silently disabling a rule to dodge violations is how this
// config drifted out of sync with our own style. If a rule is genuinely wrong,
// raise it — don't quietly switch it off. Burn down debt rule-by-rule instead.
import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint";
export default [
  ...vibeCheck({ react: true }),
  {
    rules: {
      "max-params": ["error", 2],
      // react-hooks v7 added this rule. The codebase has several legitimate
      // setState-in-effect call sites (transcription buffering, route param
      // resets, etc.) that are flagged but not actually wrong for our usage.
      // Disable until/unless we do a real audit.
      "react-hooks/set-state-in-effect": "off",
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
