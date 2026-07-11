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
  {
    // Same options as the preset, plus an allowance for TanStack Router's
    // `throw redirect(...)` pattern — the router catches thrown Redirects
    // (router.tsx route guards).
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/only-throw-error": [
        "error",
        {
          allowRethrowing: true,
          allowThrowingAny: false,
          allowThrowingUnknown: false,
          allow: [{ from: "package", name: "Redirect", package: "@tanstack/router-core" }],
        },
      ],
    },
  },
  {
    // XState's `useMachine` is SSR-unsafe used directly. The project's
    // `useSSRMachine` wrapper (src/hooks/useSSRMachine.ts) hydrates the machine
    // snapshot from SSRStateContext, so SSR safety is guaranteed rather than
    // convention-only — a bare `useMachine` compiles and runs fine on the
    // client but breaks (or silently diverges) under SSR. Enforce the wrapper
    // everywhere except the wrapper itself.
    // (issues/code-quality/2026-07-04-ssr-lint-rule-for-usessrmachine.md)
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/hooks/useSSRMachine.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@xstate/react",
              importNames: ["useMachine"],
              message:
                "Import `useSSRMachine` from src/hooks/useSSRMachine.ts instead of `useMachine` from @xstate/react — the wrapper hydrates the machine snapshot from SSRStateContext so SSR is safe; a bare useMachine only works client-side.",
            },
          ],
        },
      ],
    },
  },
];
