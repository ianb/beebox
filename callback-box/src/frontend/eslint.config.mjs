// ⚠️ DO NOT disable or turn "off" any lint rule here without very clear and
// explicit permission from the user. Every rule in personal-vibe-check is a
// deliberate choice. Silently disabling a rule to dodge violations is how this
// config drifted out of sync with our own style. If a rule is genuinely wrong,
// raise it — don't quietly switch it off. Burn down debt rule-by-rule instead.
import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint";

// --- Frontend import-boundary contract (project-local; see
// docs/plans/clerk-contract-and-import-boundary.md Track 2, and the paths
// comment in tsconfig.json). The frontend must not import backend source by a
// raw relative path that escapes src/frontend/: type imports go through the
// @core/@schemas/@backend type-only aliases; value imports go through @shared
// (relocate the value into src/shared/ if it isn't there yet). This is a
// spelling-based ban (no-restricted-imports patterns) — NOT
// import-x/no-restricted-paths, which silently skips imports its resolver
// can't resolve; with this repo's broken frontend ts-resolver an alias import
// would pass by accident, not design. The raw spellings are banned; the alias
// spellings are legal, which is honest about intent.
const XSTATE_USE_MACHINE = {
  name: "@xstate/react",
  importNames: ["useMachine"],
  message:
    "Import `useSSRMachine` from src/hooks/useSSRMachine.ts instead of `useMachine` from @xstate/react — the wrapper hydrates the machine snapshot from SSRStateContext so SSR is safe; a bare useMachine only works client-side.",
};
// Backend source directories that DO NOT exist as frontend subdirs, so any raw
// relative path with the segment (at any climb-out depth) is an escape. The
// alias `@core/…` etc. is a distinct segment (`@core` ≠ `core`) and stays legal.
const BOUNDARY_BAN_MESSAGE =
  "Don't import backend source by a raw relative path that escapes src/frontend/. Use the @core/@schemas/@backend type-only aliases for TYPES; for a VALUE, relocate it into src/shared/ and import via @shared. (tsconfig.json paths + this file are the boundary contract.)";
const BOUNDARY_PATTERNS = [
  {
    group: [
      "**/core/**",
      "**/webapp/**",
      "**/schemas/**",
      "**/services/**",
      "**/cards/**",
      "**/scenario/**",
    ],
    message: BOUNDARY_BAN_MESSAGE,
  },
  {
    // The frontend has its OWN src/lib/ (reached at ≤3 climb-outs — verified).
    // The backend src/lib/ is only reachable at 4+ climb-outs, so these exact
    // depths cannot false-positive on an intra-frontend `../lib/…` import.
    // (A deliberately de-normalized spelling like `../../../../x/../lib/y` would
    // slip past this exact-depth list — accepted: the gate stops accidental
    // escapes at real depths, not adversarial path obfuscation. The core/webapp/
    // … bans above use `**/<dir>/**`, which any prefix matches, so only `lib`
    // — constrained by the frontend's own shallower lib/ — is depth-specific.)
    group: ["../../../../lib/**", "../../../../../lib/**", "../../../../../../lib/**"],
    message:
      "Don't import the backend src/lib/ from the frontend. Move the helper into src/shared/ and import via @shared (the frontend's own src/lib/ is shallower, so this depth is always the backend lib).",
  },
  {
    // The @core/@schemas/@backend aliases are TYPE-ONLY (deliberately unaliased
    // in vite.config.ts). Ban VALUE imports through them — `allowTypeImports`
    // keeps `import type …` legal. Without this, a value import through the
    // alias passes lint AND resolves under tsx / `cb render` (both run with the
    // frontend tsconfig, which honors these paths — verified 2026-07-12), so it
    // would execute a backend graph in the SSR/doctest path even though the
    // Vite client build rejects it. Needs @typescript-eslint/no-restricted-
    // imports (the base ESLint rule has no `allowTypeImports`).
    group: ["@core/**", "@schemas/**", "@backend/**"],
    allowTypeImports: true,
    message:
      "@core/@schemas/@backend are TYPE-ONLY aliases (no Vite alias). Import only types (`import type …`). A value import executes under tsx/`cb render` and pulls backend source into that graph — relocate the value into src/shared/ and import via @shared.",
  },
];
// src/shared/ is bundler-safe, so a raw `../shared/…` bundles nothing harmful —
// but the convention is the @shared alias. Banned raw EXCEPT for modules that
// run OUTSIDE Vite where @shared can't resolve: the tap/tsx DOCTEST runner uses
// the ROOT tsconfig (no @shared path), and the view-widgets esbuild bundle
// externalizes packages and can't resolve the alias. (`cb render` is NOT such a
// context — it runs tsx with the frontend tsconfig, which resolves @shared.)
// Those files — proven by the 2026-07-12 probe — must import shared by raw
// relative path and are exempted from THIS pattern below (they still carry the
// core/webapp/… ban).
const SHARED_ALIAS_PATTERN = {
  group: ["**/shared/**"],
  message:
    "Import shared modules via the @shared/* alias, not a raw relative path. (Raw relative is reserved for the few modules that run outside Vite — doctests, `cb render`, the view-widgets bundle — where @shared can't resolve; those are exempted in eslint.config.mjs.)",
};
// Modules exercised outside the Vite bundler that legitimately import src/shared/
// by raw relative path (@shared unresolvable there — see SHARED_ALIAS_PATTERN).
const OUTSIDE_VITE_SHARED_RAW = [
  "src/lib/view-url.ts",
  "src/lib/parseTags.ts",
  "src/lib/structured-output-parsing.ts",
  "src/lib/audio/speech-parsing.ts",
  "src/machines/chat-shared.ts",
  "src/components/view-widgets/node-entry.tsx",
  // Transitively loaded by the tap/tsx doctest runner via input/emission +
  // input/voice-intent (root tsconfig, no @shared resolution).
  "src/components/chat/InteractiveChat-helpers.ts",
];

export default [
  ...vibeCheck({ react: true }),
  // Base import-boundary + useMachine ban: every frontend source file except
  // src/ssr/** (quasi-backend `cb render` entry — exempt) and the wrapper
  // itself. no-restricted-imports does NOT merge across flat configs (last
  // match wins), so useMachine + the boundary patterns are declared together.
  // Uses @typescript-eslint/no-restricted-imports (for `allowTypeImports` on the
  // alias-value ban); the base rule is turned off here so the two don't
  // double-report on these files.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/ssr/**", "src/hooks/useSSRMachine.ts"],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { paths: [XSTATE_USE_MACHINE], patterns: [...BOUNDARY_PATTERNS, SHARED_ALIAS_PATTERN] },
      ],
    },
  },
  // src/ssr/** — quasi-backend: keep the useMachine ban, drop the boundary ban.
  {
    files: ["src/ssr/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": ["error", { paths: [XSTATE_USE_MACHINE] }],
    },
  },
  // The useSSRMachine wrapper: boundary ban applies, useMachine allowed (it IS
  // the sanctioned wrapper around useMachine).
  {
    files: ["src/hooks/useSSRMachine.ts"],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [...BOUNDARY_PATTERNS, SHARED_ALIAS_PATTERN] },
      ],
    },
  },
  // Outside-Vite modules: full boundary ban MINUS the @shared-alias rule (they
  // must import src/shared/ by raw relative path — @shared can't resolve there).
  {
    files: OUTSIDE_VITE_SHARED_RAW,
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { paths: [XSTATE_USE_MACHINE], patterns: [...BOUNDARY_PATTERNS] },
      ],
    },
  },
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
];
