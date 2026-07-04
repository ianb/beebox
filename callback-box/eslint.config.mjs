// ⚠️ DO NOT disable or turn "off" any lint rule here without very clear and
// explicit permission from the user. Every rule in personal-vibe-check is a
// deliberate choice, and several restate CODE-STYLE.md. Silently disabling a
// rule to make a new preset land (or to dodge a wave of violations) is exactly
// how this config ended up lying about our style for months. If a rule is
// genuinely wrong, raise it — don't quietly switch it off. Existing debt is
// tracked and burned down rule-by-rule; see ../docs/eslint-rule-suppression-audit.md.
import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint";
export default [
  // `roots` extends the reviewed ruleset to first-party tooling under scripts/
  // (migrators etc.), which otherwise falls through to eslint-config-agent's
  // harsher global base — same rules as src/, not a weakening. See the per-edit
  // lint hook: this is what stops it flagging scripts with rules src/ is held to
  // deliberately (and `lint` below now covers scripts/ too).
  ...vibeCheck({ react: false, roots: ["src", "scripts"], ignores: ["src/frontend/**", "**/*.mjs"] }),
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
];
