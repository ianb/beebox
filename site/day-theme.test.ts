import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { dayRotation, dayThemeScript, themeStylesheets, type DayTheme } from "./day-theme.js";

const BEEBOX_DIR = path.resolve(import.meta.dirname, "..", "beebox");

test("the rotation is every system theme with the app's default card pairing", () => {
  const rotation = dayRotation();
  assert.equal(rotation.length, 13);
  const byName = new Map(rotation.map((theme) => [theme.system, theme]));
  assert.deepEqual(byName.get("far-horizon"), { system: "far-horizon", stock: "gouache", systemComposition: "expressive", card: "far-horizon", cardStock: "gouache", cardComposition: "expressive" });
  assert.equal(byName.get("spectrum")?.card, "plain");
  assert.equal(byName.get("paper")?.card, "paper");
  assert.equal(byName.has("post-it"), false);
});

test("theme stylesheets follow the app entry point's imports", async () => {
  const names = await themeStylesheets(BEEBOX_DIR);
  assert.equal(names[0], "materials.css");
  assert.ok(names.includes("chrome.css") && names.includes("far-horizon.css"));
});

interface FakeEl { attrs: Map<string, string>; setAttribute(n: string, v: string): void; removeAttribute(n: string): void }
function fakeEl(): FakeEl {
  const attrs = new Map<string, string>();
  return { attrs, setAttribute: (n, v) => { attrs.set(n, v); }, removeAttribute: (n) => { attrs.delete(n); } };
}

test("the script themes the body and every card for the visitor's local day", () => {
  const rotation: DayTheme[] = dayRotation();
  const body = fakeEl();
  const cards = [fakeEl(), fakeEl()];
  let onReady: (() => void) | undefined;
  const document = {
    body,
    querySelectorAll: () => cards,
    addEventListener: (_event: string, handler: () => void) => { onReady = handler; },
  };
  const win: { bbxDayTheme?: { theme: DayTheme } } = {};
  class Observer { observe(): void {} disconnect(): void {} }
  // Local noon, 2026-10-09; the day index counts local midnights since the epoch.
  const fixed = new Date(2026, 9, 9, 12);
  class FixedDate extends Date { constructor() { super(fixed.getTime()); } }
  new Function("document", "window", "MutationObserver", "Date", dayThemeScript(rotation))(document, win, Observer, FixedDate);
  const day = Math.floor((fixed.getTime() - fixed.getTimezoneOffset() * 60000) / 86400000);
  const expected = rotation[day % rotation.length];
  assert.ok(expected);
  assert.equal(win.bbxDayTheme?.theme.system, expected.system);
  assert.equal(body.attrs.get("data-chrome-theme"), expected.system);
  onReady?.();
  for (const card of cards) assert.equal(card.attrs.get("data-card-theme"), expected.card);
});
