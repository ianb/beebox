// The theme of the day. Every page shows one of the app's system themes,
// chosen by the visitor's local date, and every card takes that system theme's
// default card theme, the same pairing the app uses for a card with no theme of
// its own. The theme styles come from the app at build time
// (beebox/src/frontend/src/themes/, in the order the app loads them), so the site
// follows the app's design without a hand-kept copy.
//
// The day's theme comes from the themes whose appearance (light or dark)
// matches the visitor's color-scheme preference. The header's light/dark
// button switches to the other appearance, dealing its themes in shuffled
// order; the choice is remembered for later pages when browser storage allows.
//
// A small script loads synchronously at the top of <body> (no inline script:
// the site is CSP-clean) and sets the theme's attributes on <body> and on each
// card as the parser adds it, before first paint. Without JavaScript the page
// keeps the paper theme the HTML carries and the button stays hidden.

import fs from "node:fs/promises";
import path from "node:path";
import { THEME_CATALOG, systemCardThemes, type ThemeDescriptor } from "../beebox/src/shared/card-theme/catalog.js";

export interface DayTheme {
  system: string;
  appearance: "light" | "dark";
  stock: string;
  card: string;
  cardStock: string;
}

/** Every system theme, in catalog order, with its default card pairing. */
export function dayRotation(): DayTheme[] {
  // A chrome theme without an `appearance` in the catalog is a type error here.
  return THEME_CATALOG.filter((theme): theme is Extract<ThemeDescriptor, { chrome: true }> => theme.chrome).map((theme) => {
    const card = systemCardThemes(theme.name)[0] ?? "plain";
    const cardTheme = THEME_CATALOG.find((item) => item.name === card);
    if (cardTheme === undefined) throw new Error(`system theme ${theme.name}: unknown card theme ${card}`);
    return {
      system: theme.name,
      appearance: theme.appearance,
      stock: theme.defaultStock,
      card,
      cardStock: cardTheme.defaultStock,
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

/**
 * Writes dist/assets/themes/themes.css (all theme rules, one file) and copies
 * the images those rules name with `url("./…")` beside it, so the relative
 * URLs resolve as they do in the app. A named image that is missing fails the
 * build rather than shipping a theme without its artwork.
 */
export async function writeThemeAssets(params: { beeboxDir: string; distDir: string }): Promise<void> {
  const themesDir = path.join(params.beeboxDir, "src/frontend/src/themes");
  const outDir = path.join(params.distDir, "assets/themes");
  await fs.mkdir(outDir, { recursive: true });
  const parts: string[] = [];
  for (const name of await themeStylesheets(params.beeboxDir)) {
    parts.push(`/* ---- ${name} (beebox/src/frontend/src/themes/) ---- */\n${await fs.readFile(path.join(themesDir, name), "utf8")}`);
  }
  const css = parts.join("\n");
  for (const image of themeImages(css)) {
    await fs.copyFile(path.join(themesDir, image), path.join(outDir, image));
  }
  await fs.writeFile(path.join(outDir, "themes.css"), css, "utf8");
}

/** The sibling files a stylesheet names with `url("./…")`, without fragments. */
export function themeImages(css: string): string[] {
  const names = [...css.matchAll(/url\(["']?\.\/([\w.-]+?)(?:#[\w-]*)?["']?\)/g)].map((match) => match[1] ?? "");
  return [...new Set(names)].toSorted();
}

export function dayThemeScript(rotation: readonly DayTheme[]): string {
  return `(() => {
  const ROTATION = ${JSON.stringify(rotation)};
  const KEY = 'bbx-site-theme';
  const DECK = 'bbx-site-theme-deck';
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage blocked: the choice lasts this page */ } };
  const of = appearance => ROTATION.filter(theme => theme.appearance === appearance);
  const dayPick = () => {
    const dark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
    const list = of(dark ? 'dark' : 'light');
    const choices = list.length > 0 ? list : ROTATION;
    const now = new Date();
    const day = Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / 86400000);
    return choices[((day % choices.length) + choices.length) % choices.length];
  };
  let pick = ROTATION.find(theme => theme.system === read(KEY)) || dayPick();
  if (!pick) return;
  const set = (el, name, value) => { if (value === null) el.removeAttribute(name); else el.setAttribute(name, value); };
  const body = document.body;
  const card = el => {
    set(el, 'data-card-theme', pick.card);
    set(el, 'data-card-stock', pick.cardStock);
  };
  const apply = root => { for (const el of root.querySelectorAll('.bbx-card-surface')) card(el); };
  const show = () => {
    set(body, 'data-chrome-theme', pick.system);
    set(body, 'data-chrome-stock', pick.stock);
    set(body, 'data-site-appearance', pick.appearance);
  };
  // Each appearance has a shuffled deck: the switch deals its themes one at a
  // time and reshuffles only once all have been shown, so every theme comes up
  // before any repeats. The deck is kept with the choice, across pages.
  let decks = {};
  try { decks = JSON.parse(read(DECK) || '{}') || {}; } catch { decks = {}; }
  const deal = appearance => {
    const names = of(appearance).map(theme => theme.system);
    let deck = (Array.isArray(decks[appearance]) ? decks[appearance] : []).filter(name => names.includes(name) && name !== pick.system);
    if (deck.length === 0) {
      deck = names.filter(name => name !== pick.system);
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      // A new deck never opens with the theme the last one ended on.
      const last = decks[appearance + '-last'];
      if (deck.length > 1 && deck[0] === last) deck.push(deck.shift());
    }
    const name = deck.shift();
    decks[appearance] = deck;
    decks[appearance + '-last'] = name;
    write(DECK, JSON.stringify(decks));
    return ROTATION.find(theme => theme.system === name);
  };
  const toggle = () => {
    const next = deal(pick.appearance === 'dark' ? 'light' : 'dark');
    if (!next) return;
    pick = next;
    window.bbxDayTheme.theme = pick;
    write(KEY, pick.system);
    show();
    apply(document);
  };
  show();
  window.bbxDayTheme = { apply, toggle, theme: pick };
  // The header (and its button) is replaced on each page swap, so the click
  // is caught at the document.
  document.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('[data-theme-toggle]')) toggle();
  });
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
