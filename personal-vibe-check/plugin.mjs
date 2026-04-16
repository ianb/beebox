/**
 * Custom ESLint plugin bundling personal-vibe-check's own rules.
 *
 * Currently exposes one rule:
 *   - `restrict-component-classes` — validates that className on designated
 *     components is restricted to outer-layout classes (margin, padding,
 *     flex/grid item, sizing, position).
 *
 * Typically consumed via `vibeCheck()` options rather than registered
 * directly, but the plugin is exported in case a project wants to use the
 * rule without the rest of the config.
 */

import restrictComponentClasses from "./rules/restrict-component-classes.mjs";

const plugin = {
  meta: { name: "personal-vibe-check" },
  rules: {
    "restrict-component-classes": restrictComponentClasses,
  },
};

export default plugin;
