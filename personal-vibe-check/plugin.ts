/**
 * Custom ESLint plugin bundling personal-vibe-check's own rules.
 *
 * Rules:
 *   - `restrict-component-classes` — validates that className on designated
 *     components is restricted to outer-layout classes (margin, padding,
 *     flex/grid item, sizing, position).
 *   - `ime-safe-enter` — a keydown handler that acts on Enter must skip IME
 *     composition. On with `react: true`.
 *
 * Typically consumed via `vibeCheck()` options rather than registered
 * directly, but the plugin is exported in case a project wants to use the
 * rule without the rest of the config.
 */

import imeSafeEnter from "./rules/ime-safe-enter.ts";
import restrictComponentClasses from "./rules/restrict-component-classes.ts";

const plugin = {
  meta: { name: "personal-vibe-check" },
  rules: {
    "restrict-component-classes": restrictComponentClasses,
    "ime-safe-enter": imeSafeEnter,
  },
};

export default plugin;
