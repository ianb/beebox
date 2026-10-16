/** Real Deck settings and workspace surfaces; uses the existing theme-tour
 * fixtures and restores the previous system choice after the walk. */
import { invariant } from "../../src/shared/invariant.js";
import { tour } from "./tour-lib/registry.js";
import type { TourContext } from "./tour-lib/types.js";

/** The click only dispatches a mutation. Wait for its refetch before leaving
 * Settings, and surface backend catalog/version errors instead of touring the
 * previously selected theme. */
async function waitForSavedTheme(t: TourContext, label: string | null): Promise<void> {
  const result: unknown = JSON.parse(await t.eval(`new Promise(resolve => {
    const label = ${JSON.stringify(label)};
    const section = document.querySelector('section[aria-label="System theme"]');
    const observer = new MutationObserver(check);
    const timeout = setTimeout(() => finish("Timed out waiting for the system theme save"), 20000);
    function finish(result) { clearTimeout(timeout); observer.disconnect(); resolve(result); }
    function check() {
      const text = section?.textContent ?? "";
      const error = text.indexOf("Could not save system theme:");
      if (error !== -1) { finish(text.slice(error)); return; }
      if (section?.querySelector('.bbx-system-theme-swatches')?.getAttribute('aria-busy') !== 'false') return;
      const selected = section.querySelector('button.bbx-system-theme-button[aria-pressed=true]')?.getAttribute('aria-label');
      const reset = section.querySelector('[id^=bbx-box-system-theme-default]');
      if (label === null ? reset?.disabled : selected === label) finish("saved");
    }
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
    check();
  })`));
  invariant(result === "saved", `System theme save failed: ${String(result)}`);
}

tour({ name: "deck-theme", description: "Deck appearance on settings, cards and composer menus." }, async (t) => {
  await t.go("/settings");
  await t.expect.heading("System theme", { level: 2 });
  const previousLabel: unknown = JSON.parse(await t.eval('document.querySelector("button.bbx-system-theme-button[aria-pressed=true]")?.getAttribute("aria-label")'));
  invariant(typeof previousLabel === "string", "The system theme picker must have a selected theme");
  const inherited = (await t.eval('document.querySelector("[id^=bbx-box-system-theme-default]")?.disabled')).trim() === "true";
  await t.eval('document.querySelector("button.bbx-system-theme-button[aria-label=Deck]")?.scrollIntoView({block: "center"})');
  try {
    await t.click({ role: "button", name: "Deck" });
    await waitForSavedTheme(t, "Deck");
    await t.go("/settings");
    const selected = await t.eval('document.querySelector("button.bbx-system-theme-button[aria-label=Deck]")?.getAttribute("aria-pressed")');
    invariant(selected.trim() === '"true"', "Deck selection must survive navigation before inspecting theme surfaces");
    await t.checkpoint("deck-selected");
    await t.go("/chat?session=new&engine=codex&card=_content%2Ftheme-tour%2Fbloom-inherited.doc.card");
    await t.expect.heading("A little room to grow", { level: 2 });
    const material = await t.eval('document.querySelector(".bbx-card-surface[data-card-theme=deck]") !== null');
    await t.expect.custom("unthemed card inherits Deck", () => material.trim() === "true");
    await t.checkpoint("deck-workspace");
    await t.expect.noPageErrors();
    await t.click({ role: "button", name: "Add" });
    await t.checkpoint("deck-composer-menu");
    await t.go("/views/_content/theme-tour/bloom-explicit.doc.card");
    await t.expect.heading("A note on blue paper", { level: 2 });
    const paper = await t.eval('document.querySelector(".bbx-card-surface[data-card-theme=paper][data-card-stock=blue]") !== null');
    await t.expect.custom("explicit Paper material stays intact", () => paper.trim() === "true");
    const headingColor = await t.eval('getComputedStyle(document.querySelector(".bbx-card-surface[data-card-theme=paper][data-card-stock=blue] h2")).color');
    await t.expect.custom("explicit blue Paper heading keeps its dark ink", () => headingColor.trim() === '"rgb(38, 58, 68)"');
    await t.checkpoint("explicit-paper-on-deck");
    await t.expect.noPageErrors();
    await t.go("/settings");
    await t.eval('document.querySelector("[id^=bbx-box-system-theme-default]")?.scrollIntoView({block: "center"})');
    await t.click({ role: "button", name: "Use default" });
    await waitForSavedTheme(t, null);
    await t.go("/settings");
    const reset = await t.eval('document.querySelector("[id^=bbx-box-system-theme-default]")?.disabled');
    await t.expect.custom("Use default clears the box override", () => reset.trim() === "true");
  } finally {
    await t.go("/settings");
    if (inherited) {
      await t.eval('document.querySelector("[id^=bbx-box-system-theme-default]")?.scrollIntoView({block: "center"})');
      const alreadyDefault = await t.eval('document.querySelector("[id^=bbx-box-system-theme-default]")?.disabled');
      if (alreadyDefault.trim() !== "true") {
        await t.click({ role: "button", name: "Use default" });
        await waitForSavedTheme(t, null);
      }
    } else {
      await t.eval(`Array.from(document.querySelectorAll("button.bbx-system-theme-button")).find(button => button.getAttribute("aria-label") === ${JSON.stringify(previousLabel)})?.scrollIntoView({block: "center"})`);
      await t.click({ role: "button", name: previousLabel });
      await waitForSavedTheme(t, previousLabel);
    }
  }
});
