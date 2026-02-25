import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Waffle-inspired palette
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
        // Warm neutrals (replacing gray for backgrounds/text)
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
      },
    },
  },
  plugins: [typography],
};
