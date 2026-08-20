// ⚠️ DO NOT disable or turn "off" any lint rule here without very clear and
// explicit permission from the user. Every rule in personal-vibe-check is a
// deliberate choice, and several restate code-style.md. Silently disabling a
// rule to make a new preset land (or to dodge a wave of violations) is exactly
// how this config ended up lying about our style for months. If a rule is
// genuinely wrong, raise it — don't quietly switch it off. Existing debt is
// tracked and burned down rule-by-rule; see ../docs/eslint-rule-suppression-audit.md.
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
  ...vibeCheck({ react: false, roots: ["src", "scripts", "test"], ignores: ["src/frontend/**", "**/*.mjs"] }),
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
  // ../docs/eslint-rule-suppression-audit.md.
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
    files: ["src/**/*.ts"],
    ignores: ["src/core/chat/session/target.ts", "src/core/chat/session/registry.ts"],
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
