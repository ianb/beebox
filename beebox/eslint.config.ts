// ⚠️ DO NOT disable or turn "off" any lint rule here without very clear and
// explicit permission from the user. Every rule in personal-vibe-check is a
// deliberate choice, and several restate code-style.md. Silently disabling a
// rule to make a new preset land (or to dodge a wave of violations) is exactly
// how this config ended up lying about our style for months. If a rule is
// genuinely wrong, raise it — don't quietly switch it off. Existing debt is
// tracked and burned down rule-by-rule; see ../docs/reports/eslint-rule-suppression-audit-2026-05-30.md.
import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint";

// Session creation has one owner. Four call sites used to reach
// `registry.createNew()` independently — the send route, capture and bulk
// delivery, and both schedule-fire fallbacks — with nothing making them agree,
// so a capture delivering while the composer sent produced two chats for one
// intended conversation. `core/chat/session/target.ts` is the only caller now;
// everything else asks it to resolve a `ChatTargetSpec`.
//
// Expressed with `no-restricted-properties` rather than `no-restricted-syntax`
// on purpose: a second `no-restricted-syntax` entry REPLACES the preset's,
// which is where the repo-wide `as`-cast ban lives (verified — a bare
// `v as string` passed lint while this was a syntax rule).
const noDirectCreateNew = {
  property: "createNew",
  message:
    "Don't call registry.createNew() directly — resolve a ChatTargetSpec through resolveChatTarget() (core/chat/session/target.ts) so one place decides who creates the chat.",
};
// A card type's LIST COMPONENT lives beside its schema:
// `src/schemas/<type>/list-entry.tsx` (boxholder decision, 2026-09-20 — "I
// want each component to live alongside the rest of the schema"; a directory
// member, like the rest of a card type's files, not a flat
// `<type>.list-entry.tsx`). It is frontend code in a backend tree, so it gets
// fenced three ways here:
//
//  1. It is linted with the REACT profile, not the backend one (the block
//     below re-runs the preset with `react: true`, scoped to this glob).
//  2. It may reach the rest of the source tree by TYPE import only — except
//     `src/shared/` (isomorphic) and `src/frontend/` (its own half). So a
//     list component can never drag the backend graph into the client bundle.
//  3. No other module may import it. The backend tsconfig excludes the glob,
//     and the ban below covers the rest of `src/`.
//
// `src/frontend/vite.config.ts` aliases `@schemas/*.list-entry` — and only
// that spelling — so `file-types/builtins.tsx` can import it by the type-only
// alias without opening the alias for anything else.
const LIST_ENTRY_GLOB = "src/schemas/*/list-entry.tsx";
const LIST_ENTRY_IMPORT_PATTERNS = ["**/list-entry", "**/list-entry.js", "**/list-entry.tsx"];

export default [
  // `roots` extends the reviewed ruleset to first-party tooling under scripts/
  // (migrators etc.), which otherwise falls through to eslint-config-agent's
  // harsher global base — same rules as src/, not a weakening. See the per-edit
  // lint hook: this is what stops it flagging scripts with rules src/ is held to
  // deliberately (and `lint` below now covers scripts/ too).
  // `test` in roots (added 2026-07-15): test/ is held to the same reviewed
  // ruleset as src/ — previously it fell through to eslint-config-agent's
  // harsher unreviewed base, whose extra bans (`??`, inline unions,
  // process.env["X"], fs-filename) are NOT house style and made per-edit hook
  // reports on test files misleading. `pnpm lint` and lint-staged enforce it.
  ...vibeCheck({ react: false, roots: ["src", "test"], ignores: ["src/frontend/**", "**/*.mjs"] }),
  // The React profile, scoped to list components (see LIST_ENTRY_GLOB above).
  // Every entry is re-scoped to the glob so nothing else in this package picks
  // up React rules.
  ...vibeCheck({ react: true }).map(config => ({ ...config, files: [LIST_ENTRY_GLOB] })),
  {
    // Type-aware rules need the program this file actually belongs to. The
    // package tsconfig excludes the glob (it is not backend code), so point
    // the parser at the frontend project, which includes it.
    files: [LIST_ENTRY_GLOB],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ["./src/frontend/tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      "max-params": ["error", 2],
      // Kept off deliberately. personal-vibe-check itself disables this as
      // "nonsensical" (requires className on every JSX element), but its preset
      // re-enables it for .tsx/JSX files — where our schema files (e.g.
      // capture-session.tsx) legitimately render className-free elements.
      "custom/jsx-classname-required": "off",
    },
  },
  // NOTE: The other 16 rules in this block were turned off when
  // personal-vibe-check was integrated (1efb334c, 2026-02-14), silently
  // disabling a chunk of our own documented style. They are now re-enabled;
  // existing debt is burned down rule-by-rule. See
  // ../docs/reports/eslint-rule-suppression-audit-2026-05-30.md.
  {
    // return-await (personal-vibe-check, enabled repo-wide) is off for route
    // handlers specifically: 30 of ~35 backend hits are Fastify
    // `return reply.send(...)` inside a try-block whose catch re-sends on
    // error. Forcing `await` there routes a rejected send into the catch
    // block, which sends a *second* response and throws
    // FST_ERR_REP_ALREADY_SENT — the rule would introduce the exact bug
    // class it exists to prevent, so this directory is carved out rather
    // than the rule being weakened project-wide (measured 2026-07,
    // issues/2026-07-06-deferred-lint-rules.md).
    files: ["src/webapp/routes/**/*.ts"],
    rules: {
      "@typescript-eslint/return-await": "off",
    },
  },
  {
    // A workflow script is handed to a runtime that parses plain JavaScript and
    // gives it no filesystem and no module resolution, so it cannot import — which
    // means it cannot be split into modules, the one remedy `max-lines` assumes.
    // Roughly 40% of each file is prompt prose handed to subagents, and shortening
    // that changes what the agents are asked.
    //
    // Carved out rather than weakened project-wide, and deliberately still bounded:
    // 400 is above today's largest (discover, 381) with little room, so a workflow
    // that keeps growing still has to answer for it. Every other rule applies in
    // full — the six generic-Error throws these files used to carry were fixed, not
    // exempted (boxholder decision, 2026-08-24).
    //
    // `@typescript-eslint/no-misused-promises` used to crash ESLint outright on
    // these files (`Non-null Assertion Failed: Expected node to have a parent`,
    // in its `checkReturnStatement`) instead of reporting a normal finding. Every
    // workflow ends in a literal top-level `return` (see workflow-globals.d.ts —
    // the runtime wraps the body in an async function, so TS's grammar error
    // TS1108 is silenced with `@ts-expect-error` on that one line); that return
    // has no enclosing function in the AST, and the rule dereferenced one
    // unconditionally.
    //
    // This was NOT a long-standing crash the fold merely surfaced: before the
    // fold, personal-vibe-check's type-aware block is hard-scoped to
    // `src/**/*.{ts,tsx}` (see preset.ts), and these files lived under
    // `user-stories/`, outside that glob — `tsconfig.user-stories.json` fed
    // `typecheck:user-stories`'s plain `tsc`, never ESLint. So the rule never
    // ran with type information against them at all (confirmed: `git show
    // 14d93deb0:beebox/user-stories/pipeline/discover.workflow.ts` lints clean
    // under that commit's config, and typescript-eslint's own debug log shows
    // it parsing "without type information"). The fold moved the files under
    // `src/`, which put them in the type-aware program for the first time and
    // exposed the crash.
    //
    // The crash itself is an upstream bug, fixed in
    // https://github.com/typescript-eslint/typescript-eslint/pull/12912
    // (issue #12911), merged 2026-09-22 but not yet in a stable release as of
    // 2026-09-27 (latest is 8.70.1; the fix only exists in canary prereleases,
    // which the workspace's 7-day `minimumReleaseAge` gate rightly refuses to
    // install). Rather than adopt an unvetted prerelease or carve out the
    // rule, `patches/@typescript-eslint+eslint-plugin+8.59.4.patch` applies
    // that exact upstream diff to the installed package via patch-package
    // (already wired into the root `postinstall`), so the rule stays fully
    // enabled — including type information — for these files. Drop that patch
    // once a released `@typescript-eslint/eslint-plugin` version already
    // contains the fix.
    files: ["src/scripts/user-stories/*.workflow.ts"],
    rules: {
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // A list component reads its schema for TYPES and renders; a value import
    // from the schemas/core/cards trees would put backend modules in the
    // client bundle. `src/shared/` and `src/frontend/` stay value-legal.
    files: [LIST_ENTRY_GLOB],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "./**",
                "../cards/**",
                "../cli/**",
                "../connectors/**",
                "../core/**",
                "../dev/**",
                "../hub/**",
                "../lib/**",
                "../schemas/**",
                "../scenario/**",
                "../services/**",
                "../types/**",
                "../webapp/**",
              ],
              allowTypeImports: true,
              message:
                "A *.list-entry.tsx file may import backend source (its schema, core, cards) as TYPES only — `import type …`. Values may come from src/shared/ and src/frontend/ only; anything else would bundle backend code into the client.",
            },
          ],
        },
      ],
    },
  },
  {
    // Nothing but the frontend registry imports a list component, and it does
    // so through the `@schemas/*.list-entry` Vite alias.
    files: ["src/**/*.{ts,tsx}", "test/**/*.ts"],
    ignores: [LIST_ENTRY_GLOB],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: LIST_ENTRY_IMPORT_PATTERNS,
              message:
                "A *.list-entry.tsx file is frontend code: React, the DOM, and the frontend's own modules. Only src/frontend/src/file-types/builtins.tsx imports one.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.ts"],
    // Only the owner is exempt. `registry.ts` defines `createNew` but no longer
    // calls it, and a method definition is not a member access — so it needs no
    // exemption, and a future `this.createNew()` there is caught like any other.
    ignores: ["src/core/chat/session/target.ts"],
    rules: {
      "no-restricted-properties": ["error", noDirectCreateNew],
    },
  },
  {
    // Box-request handlers must not stash data in the shared host temp dir:
    // multiple boxes on one host collide on a fixed `os.tmpdir()` path, and
    // user content lands outside the box it belongs to. Use the box-scoped,
    // swept `<boxRoot>/tmp/` via `ensureBoxTmpDir(boxRoot)`/`boxTmpDir(boxRoot)`
    // from `src/lib/box-tmp.ts`. (CLI/dev tooling under src/cli, src/dev, and
    // build scratch under src/webapp/views legitimately use host tmp and are
    // out of scope.) Uses `no-restricted-properties`, not the preset's
    // `no-restricted-syntax`, so the repo-wide `as`-cast ban still applies here.
    files: ["src/webapp/routes/**/*.ts", "src/webapp/trpc/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        // Repeated because this block REPLACES the rule for these files.
        noDirectCreateNew,
        {
          object: "os",
          property: "tmpdir",
          message:
            "Box-request handlers must not use host os.tmpdir(). Use ensureBoxTmpDir(boxRoot) / boxTmpDir(boxRoot) from src/lib/box-tmp.ts — the box-scoped, swept <boxRoot>/tmp/.",
        },
      ],
    },
  },
];
