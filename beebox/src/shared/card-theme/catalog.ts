export const THEME_CATALOG = [
  {
    name: "plain",
    label: "Flat",
    stocks: ["neutral"],
    defaultStock: "neutral",
    quoteTreatment: "plain",
    blockquoteTreatment: "plain",
    chrome: true,
    systemOnly: false,
    cardThemes: ["plain", "paper", "post-it"],
  },
  {
    name: "spectrum",
    label: "Spectrum",
    stocks: ["gradient"],
    defaultStock: "gradient",
    quoteTreatment: "plain",
    blockquoteTreatment: "plain",
    chrome: true,
    systemOnly: true,
    cardThemes: ["plain", "post-it"],
  },
  {
    name: "paper",
    label: "Paper",
    stocks: ["cream", "manila", "blue"],
    defaultStock: "cream",
    quoteTreatment: "layered",
    blockquoteTreatment: "layered",
    chrome: true,
    systemOnly: false,
    cardThemes: ["paper", "post-it", "letter-set"],
  },
  {
    name: "post-it",
    label: "Sticky note",
    stocks: ["yellow", "rose", "mint"],
    defaultStock: "yellow",
    quoteTreatment: "layered",
    blockquoteTreatment: "layered",
    chrome: false,
    systemOnly: false,
  },
  {
    name: "candy",
    label: "Candy",
    stocks: ["strawberry"],
    defaultStock: "strawberry",
    quoteTreatment: "plain",
    blockquoteTreatment: "plain",
    chrome: true,
    systemOnly: true,
    cardThemes: ["letter-set", "post-it"],
  },
  {
    name: "letter-set",
    label: "Letter set",
    stocks: ["strawberry", "lemon", "sky"],
    defaultStock: "strawberry",
    quoteTreatment: "layered",
    blockquoteTreatment: "layered",
    chrome: false,
    systemOnly: false,
  },
] as const;

export type ThemeDescriptor = (typeof THEME_CATALOG)[number];
export type ThemeName = ThemeDescriptor["name"];
export type ThemeStock = ThemeDescriptor["stocks"][number];

/**
 * The card themes that go with a system theme, its default first. A card with
 * no authored theme takes the default of the system theme it is shown on; the
 * picker lists the rest first. A card theme may go with several system themes.
 */
export function systemCardThemes(systemTheme: string | undefined): readonly string[] {
  const theme = THEME_CATALOG.find((item) => item.name === systemTheme);
  return theme !== undefined && "cardThemes" in theme ? theme.cardThemes : ["plain"];
}
