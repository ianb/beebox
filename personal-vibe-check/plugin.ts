/**
 * Custom ESLint plugin bundling personal-vibe-check's own rules.
 *
 * Rules:
 *   - `restrict-component-classes` — validates that className on designated
 *     components is restricted to outer-layout classes (margin, padding,
 *     flex/grid item, sizing, position).
 *   - `ime-safe-enter` — a keydown handler that acts on Enter must skip IME
 *     composition. On with `react: true`.
 *   - `aria-label-needs-role` — aria-label on div/span/p/i/b needs a role.
 *     On with `react: true`.
 *   - `prefer-native-dialog` — role="dialog"/"alertdialog" on a non-<dialog>
 *     element. On with `react: true`.
 *   - `no-viewport-height-class` — bans Tailwind h-screen / min-h-screen /
 *     max-h-screen. Tailwind-specific, so opt-in per project.
 *   - `no-px-font-size-class` — bans Tailwind `text-[<n>px]`; write rem.
 *     Tailwind-specific, so opt-in per project.
 *   - `restricted-classes` — bans configured class patterns or combinations
 *     outside the files that own them. Configured per project.
 *   - `require-ui-primitive` — bans configured elements, ARIA roles and
 *     attributes outside the files that own them. Configured per project.
 *
 * Typically consumed via `vibeCheck()` options rather than registered
 * directly, but the plugin is exported in case a project wants to use the
 * rule without the rest of the config.
 */

import ariaLabelNeedsRole from "./rules/aria-label-needs-role.ts";
import imeSafeEnter from "./rules/ime-safe-enter.ts";
import preferNativeDialog from "./rules/prefer-native-dialog.ts";
import noPxFontSizeClass from "./rules/no-px-font-size-class.ts";
import noViewportHeightClass from "./rules/no-viewport-height-class.ts";
import restrictComponentClasses from "./rules/restrict-component-classes.ts";
import requireUiPrimitive from "./rules/require-ui-primitive.ts";
import restrictedClasses from "./rules/restricted-classes.ts";

const plugin = {
  meta: { name: "personal-vibe-check" },
  rules: {
    "restrict-component-classes": restrictComponentClasses,
    "ime-safe-enter": imeSafeEnter,
    "aria-label-needs-role": ariaLabelNeedsRole,
    "no-viewport-height-class": noViewportHeightClass,
    "no-px-font-size-class": noPxFontSizeClass,
    "prefer-native-dialog": preferNativeDialog,
    "restricted-classes": restrictedClasses,
    "require-ui-primitive": requireUiPrimitive,
  },
};

export default plugin;
