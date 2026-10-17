import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { dayRotation, dayThemeScript, themeImages, themeStylesheets, type DayTheme } from "./day-theme.js";

const BEEBOX_DIR = path.resolve(import.meta.dirname, "..", "beebox");

test("the rotation is every system theme with the app's default card pairing", () => {
  const rotation = dayRotation();
  const byName = new Map(rotation.map((theme) => [theme.system, theme]));
  assert.deepEqual(byName.get("candy"), { system: "candy", appearance: "light", stock: "strawberry", card: "letter-set", cardStock: "strawberry" });
  assert.equal(byName.get("spectrum")?.card, "plain");
  assert.equal(byName.get("paper")?.card, "paper");
  assert.equal(byName.has("post-it"), false);
  assert.equal(byName.get("night-atlas")?.appearance, "dark");
  assert.ok(rotation.filter((theme) => theme.appearance === "dark").length >= 2, "the switch needs a choice of dark themes");
  assert.ok(rotation.filter((theme) => theme.appearance === "light").length >= 2, "the switch needs a choice of light themes");
});

test("theme stylesheets follow the app entry point's imports", async () => {
  const names = await themeStylesheets(BEEBOX_DIR);
  assert.equal(names[0], "materials.css");
  assert.ok(names.includes("chrome.css") && names.includes("candy.css"));
});

interface FakeEl { attrs: Map<string, string>; setAttribute(n: string, v: string): void; removeAttribute(n: string): void }
function fakeEl(): FakeEl {
  const attrs = new Map<string, string>();
  return { attrs, setAttribute: (n, v) => { attrs.set(n, v); }, removeAttribute: (n) => { attrs.delete(n); } };
}

interface Harness { body: FakeEl; cards: FakeEl[]; stored: Map<string, string>; ready(): void; click(): void; theme(): DayTheme | undefined }

/** Runs the script at local noon on 2026-10-09 with a color-scheme preference and stored choice. */
function runScript(options: { dark: boolean; stored?: string }): Harness {
  const body = fakeEl();
  const cards = [fakeEl(), fakeEl()];
  const stored = new Map<string, string>(options.stored === undefined ? [] : [["bbx-site-theme", options.stored]]);
  const handlers = new Map<string, (event: { target: unknown }) => void>();
  class FakeElement { closest(): boolean { return true; } }
  const document = {
    body,
    querySelectorAll: () => cards,
    addEventListener: (event: string, handler: (event: { target: unknown }) => void) => { handlers.set(event, handler); },
  };
  const localStorage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value); } };
  const matchMedia = (query: string) => ({ matches: options.dark && query.includes("dark") });
  const win: { bbxDayTheme?: { theme: DayTheme } } = {};
  class Observer { observe(): void {} disconnect(): void {} }
  const fixed = new Date(2026, 9, 9, 12);
  class FixedDate extends Date { constructor() { super(fixed.getTime()); } }
  new Function("document", "window", "MutationObserver", "Date", "localStorage", "matchMedia", "Element", dayThemeScript(dayRotation()))(
    document, win, Observer, FixedDate, localStorage, matchMedia, FakeElement);
  return {
    body, cards, stored,
    ready: () => { handlers.get("DOMContentLoaded")?.({ target: undefined }); },
    click: () => { handlers.get("click")?.({ target: new FakeElement() }); },
    theme: () => win.bbxDayTheme?.theme,
  };
}

test("the script themes the body and every card with the day's theme of the preferred appearance", () => {
  for (const dark of [false, true]) {
    const appearance = dark ? "dark" : "light";
    const choices = dayRotation().filter((theme) => theme.appearance === appearance);
    const fixed = new Date(2026, 9, 9, 12);
    const day = Math.floor((fixed.getTime() - fixed.getTimezoneOffset() * 60000) / 86400000);
    const expected = choices[day % choices.length];
    assert.ok(expected);
    const page = runScript({ dark });
    assert.equal(page.theme()?.system, expected.system);
    assert.equal(page.body.attrs.get("data-chrome-theme"), expected.system);
    assert.equal(page.body.attrs.get("data-site-appearance"), appearance);
    page.ready();
    for (const card of page.cards) assert.equal(card.attrs.get("data-card-theme"), expected.card);
  }
});

test("the switch picks a theme of the other appearance and remembers it", () => {
  const page = runScript({ dark: false });
  page.ready();
  page.click();
  const picked = page.theme();
  assert.equal(picked?.appearance, "dark");
  assert.equal(page.body.attrs.get("data-chrome-theme"), picked.system);
  assert.equal(page.body.attrs.get("data-site-appearance"), "dark");
  for (const card of page.cards) assert.equal(card.attrs.get("data-card-theme"), picked.card);
  assert.equal(page.stored.get("bbx-site-theme"), picked.system);
  page.click();
  assert.equal(page.theme()?.appearance, "light");

  const later = runScript({ dark: false, stored: picked.system });
  assert.equal(later.theme()?.system, picked.system);
  assert.equal(runScript({ dark: false, stored: "removed-theme" }).theme()?.appearance, "light");
});

test("the switch shows every theme of an appearance before repeating one", () => {
  const dark = dayRotation().filter((theme) => theme.appearance === "dark").map((theme) => theme.system);
  const page = runScript({ dark: false });
  page.ready();
  const seen: string[] = [];
  for (let i = 0; i < dark.length; i++) {
    page.click();
    seen.push(page.theme()?.system ?? "");
    page.click();
  }
  assert.deepEqual(seen.toSorted(), dark.toSorted());
});

test("theme images are the sibling files the stylesheets name", () => {
  assert.deepEqual(themeImages('a { background: url("./a.webp"), url(./b.svg#frame0), url("./a.webp"); } b { mask: url("data:x"); }'), ["a.webp", "b.svg"]);
});
