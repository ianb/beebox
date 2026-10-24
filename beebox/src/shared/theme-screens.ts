/**
 * Screen sizes the theme studio is viewed at and `bin/theme-check` measures
 * at: small and large phones, a portrait tablet, and laptop to large desktop.
 * The studio's screen picker and theme-check read this one list.
 */
export const SCREENS = [
  { name: "phone", label: "Phone", width: 375, height: 667 },
  { name: "large-phone", label: "Large phone", width: 430, height: 932 },
  { name: "tablet", label: "Tablet", width: 768, height: 1024 },
  { name: "laptop", label: "Laptop", width: 1366, height: 768 },
  { name: "desktop", label: "Desktop", width: 1920, height: 1200 },
  { name: "large-desktop", label: "Large desktop", width: 2560, height: 1440 },
] as const;

export type Screen = (typeof SCREENS)[number];
export type ScreenName = Screen["name"];

export function findScreen(name: string | undefined): Screen | undefined {
  return SCREENS.find((screen) => screen.name === name);
}
