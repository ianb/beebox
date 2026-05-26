import typography from "@tailwindcss/typography";

// ─── Palette values ─────────────────────────────────────────────────
// Named hex constants so the semantic aliases below can reference the
// same values as the (transitional) brand names.

const palette = {
  gold: {
    DEFAULT: "#E8A838",
    light: "#F0C56E",
    dark: "#C98A20",
    50: "#FDF6E8",
    100: "#FBE9C5",
  },
  coral: {
    DEFAULT: "#D4845A",
    light: "#E0A080",
    dark: "#B56A40",
    50: "#FBF2EC",
  },
  rose: {
    DEFAULT: "#C2788A",
    light: "#D49AAA",
    dark: "#A05A6C",
    50: "#F9EEF0",
    100: "#F2DDE1",
  },
  plum: {
    DEFAULT: "#9B6BA6",
    light: "#B88DC0",
    dark: "#7B4F8A",
    50: "#F3ECF5",
    100: "#E4D6E9",
  },
  iris: {
    DEFAULT: "#7B6FB0",
    light: "#9B92C8",
    dark: "#5E5490",
    50: "#EEEDF5",
    100: "#D8D4E8",
    muted: "#C4BAD8",
  },
  // Success — warm-friendly green, calm not neon.
  success: {
    DEFAULT: "#4F9E5E",
    light: "#7BBC87",
    dark: "#3C7F49",
    50: "#EBF5ED",
    100: "#D6EADD",
  },
  // Warning — amber/ochre, matches the warm palette's temperature.
  warning: {
    DEFAULT: "#D99A2B",
    light: "#E8B85F",
    dark: "#B07D1C",
    50: "#FBF3E4",
    100: "#F6E4BC",
  },
  // Warm neutrals — used for backgrounds and body text.
  warm: {
    50: "#FBF5EE",
    100: "#F7F0E6",
    200: "#F3EBE0",
    300: "#E8DDD0",
    400: "#D9CEBD",
    500: "#B8A890",
    600: "#9B8E7E",
    700: "#6B5D4B",
    800: "#4A3F32",
    900: "#2E2720",
  },
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // ─── Semantic roles ────────────────────────────────────────
        // Components should reach for these names, not the brand
        // names below. The mapping is intentional:
        //   primary  — main brand action (was plum)
        //   accent   — highlights, CTAs, focus rings (was gold)
        //   info     — informational callouts (was iris, folds purple-*)
        //   danger   — destructive actions + error states (was rose, folds red-*)
        //   success  — positive confirmations (was green-*)
        //   warning  — caution, dirty state (was yellow-* / amber-*)
        primary: palette.plum,
        accent: palette.gold,
        info: palette.iris,
        danger: palette.rose,
        success: palette.success,
        warning: palette.warning,

        // ─── Brand-specific accent ─────────────────────────────────
        // Coral has no clean semantic mapping; it's used in the
        // app-nav gradient alongside primary and info.
        coral: palette.coral,

        // ─── Warm neutral scale ────────────────────────────────────
        // The neutral surface/text scale. Use directly (no semantic
        // alias) — warm-50..900 is self-documenting as a shade scale.
        warm: palette.warm,
      },
    },
  },
  plugins: [typography],
};
