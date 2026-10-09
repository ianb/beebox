// The theme of the day. Every page shows one of the app's system themes,
// chosen by the visitor's local date, and every card takes that system theme's
// default card theme, the same pairing the app uses for a card with no theme of
// its own. The theme styles and art come from the app at build time
// (beebox/src/frontend/src/themes/, in the order the app loads them), so the site
// follows the app's design without a hand-kept copy. Each theme's art is
// referenced only by its own rules, so a visitor downloads one day's art.
//
// A small script loads synchronously at the top of <body> (no inline script:
// the site is CSP-clean) and sets the day's attributes on <body> and on each
// card as the parser adds it, before first paint. Without JavaScript the page
// keeps the paper theme the HTML carries.

import fs from "node:fs/promises";
import path from "node:path";
import { THEME_CATALOG, systemCardThemes, themeComposition } from "../beebox/src/shared/card-theme/catalog.js";

export interface DayTheme {
  system: string;
  stock: string;
  systemComposition: string | null;
  card: string;
  cardStock: string;
  cardComposition: string | null;
}

/** Every system theme, in catalog order, with its default card pairing. */
export function dayRotation(): DayTheme[] {
  return THEME_CATALOG.filter((theme) => theme.chrome).map((theme) => {
    const card = systemCardThemes(theme.name)[0] ?? "plain";
    const cardTheme = THEME_CATALOG.find((item) => item.name === card);
    if (cardTheme === undefined) throw new Error(`system theme ${theme.name}: unknown card theme ${card}`);
    return {
      system: theme.name,
      stock: theme.defaultStock,
      systemComposition: themeComposition(theme.name) ?? null,
      card,
      cardStock: cardTheme.defaultStock,
      cardComposition: themeComposition(card) ?? null,
    };
  });
}

/** The app's theme stylesheets, in the order its entry point imports them. */
export async function themeStylesheets(beeboxDir: string): Promise<string[]> {
  const entry = await fs.readFile(path.join(beeboxDir, "src/frontend/src/main/app.tsx"), "utf8");
  const names = [...entry.matchAll(/^import "\.\.\/themes\/([\w-]+\.css)";$/gm)].map((match) => match[1] ?? "");
  if (names.length === 0) throw new Error("no theme stylesheets imported by beebox/src/frontend/src/main/app.tsx");
  return names;
}

/** Writes dist/assets/themes/themes.css (all theme rules, one file) and its art/. */
export async function writeThemeAssets(params: { beeboxDir: string; distDir: string }): Promise<void> {
  const themesDir = path.join(params.beeboxDir, "src/frontend/src/themes");
  const outDir = path.join(params.distDir, "assets/themes");
  await fs.mkdir(outDir, { recursive: true });
  const parts: string[] = [];
  for (const name of await themeStylesheets(params.beeboxDir)) {
    parts.push(`/* ---- ${name} (beebox/src/frontend/src/themes/) ---- */\n${await fs.readFile(path.join(themesDir, name), "utf8")}`);
  }
  await fs.writeFile(path.join(outDir, "themes.css"), parts.join("\n"), "utf8");
  await fs.cp(path.join(themesDir, "art"), path.join(outDir, "art"), { recursive: true });
}

export function dayThemeScript(rotation: readonly DayTheme[]): string {
  return `(() => {
  const ROTATION = ${JSON.stringify(rotation)};
  const now = new Date();
  const day = Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / 86400000);
  const pick = ROTATION[((day % ROTATION.length) + ROTATION.length) % ROTATION.length];
  if (!pick) return;
  const set = (el, name, value) => { if (value === null) el.removeAttribute(name); else el.setAttribute(name, value); };
  const body = document.body;
  set(body, 'data-chrome-theme', pick.system);
  set(body, 'data-chrome-stock', pick.stock);
  set(body, 'data-theme-composition', pick.systemComposition);
  const card = el => {
    set(el, 'data-card-theme', pick.card);
    set(el, 'data-card-stock', pick.cardStock);
    set(el, 'data-theme-composition', pick.cardComposition);
  };
  const apply = root => { for (const el of root.querySelectorAll('.bbx-card-surface')) card(el); };
  window.bbxDayTheme = { apply, theme: pick };
  // Cards are themed as the parser adds them, before the first paint; a page
  // swap by navigation.js calls apply() on the incoming content.
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches('.bbx-card-surface')) card(node);
      apply(node);
    }
  });
  observer.observe(body, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => { observer.disconnect(); apply(document); }, { once: true });
})();
`;
}
