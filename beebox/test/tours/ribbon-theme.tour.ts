/** Real Ribbon settings and workspace surfaces; uses the existing theme-tour
 * fixtures and restores the previous system choice after the walk. */
import { invariant } from "../../src/shared/invariant.js";
import { tour } from "./tour-lib/registry.js";

tour({ name: "ribbon-theme", description: "Ribbon appearance on settings, cards and composer menus." }, async (t) => {
  await t.go("/settings");
  await t.expect.heading("System theme", { level: 2 });
  const previousLabel: unknown = JSON.parse(await t.eval('document.querySelector("button.bbx-system-theme-button[aria-pressed=true]")?.getAttribute("aria-label")'));
  invariant(typeof previousLabel === "string", "The system theme picker must have a selected theme");
  const inherited = (await t.eval('document.querySelector("[id^=bbx-box-system-theme-default]")?.disabled')).trim() === "true";
  await t.eval('document.querySelector("button.bbx-system-theme-button[aria-label=Ribbon]")?.scrollIntoView({block: "center"})');
  await t.click({ role: "button", name: "Ribbon" });
  try {
    await t.go("/settings");
    const selected = await t.eval('document.querySelector("button.bbx-system-theme-button[aria-label=Ribbon]")?.getAttribute("aria-pressed")');
    await t.expect.custom("Ribbon selection survives navigation", () => selected.trim() === '"true"');
    await t.checkpoint("ribbon-selected");
    await t.go("/chat?session=new&engine=codex&card=_content%2Ftheme-tour%2Fbloom-inherited.memo.card");
    await t.expect.heading("A little room to grow", { level: 2 });
    const material = await t.eval('document.querySelector(".bbx-card-surface[data-card-theme=ribbon]") !== null');
    await t.expect.custom("unthemed card inherits Ribbon", () => material.trim() === "true");
    await t.checkpoint("ribbon-workspace");
    await t.expect.noPageErrors();
    await t.click({ role: "button", name: "Add" });
    await t.checkpoint("ribbon-composer-menu");
    await t.go("/views/_content/theme-tour/bloom-explicit.memo.card");
    await t.expect.heading("A note on blue paper", { level: 2 });
    const paper = await t.eval('document.querySelector(".bbx-card-surface[data-card-theme=paper][data-card-stock=blue]") !== null');
    await t.expect.custom("explicit Paper material stays intact", () => paper.trim() === "true");
    await t.checkpoint("explicit-paper-on-ribbon");
    await t.expect.noPageErrors();
  } finally {
    await t.go("/settings");
    if (inherited) {
      await t.eval('document.querySelector("[id^=bbx-box-system-theme-default]")?.scrollIntoView({block: "center"})');
      await t.click({ role: "button", name: "Use default" });
    } else {
      await t.eval(`Array.from(document.querySelectorAll("button.bbx-system-theme-button")).find(button => button.getAttribute("aria-label") === ${JSON.stringify(previousLabel)})?.scrollIntoView({block: "center"})`);
      await t.click({ role: "button", name: previousLabel });
    }
  }
});
