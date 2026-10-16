/** Selects Bloom then restores the built-in default in the isolated test box.
 * Covers real chrome, cards, and menus; synthetic message rendering is checked
 * separately without a model call. Install the theme-tour fixtures first. */
import { tour } from "./tour-lib/registry.js";

tour({ name: "bloom-theme", description: "Bloom appearance on real settings, workspace, cards and menus." }, async (t) => {
  await t.go("/settings");
  await t.expect.heading("System theme", { level: 2 });
  await t.expect.button("Bloom");
  await t.eval('document.querySelector("button.bbx-system-theme-button[aria-label=Bloom]")?.scrollIntoView({block: "center"})');
  await t.click({ role: "button", name: "Bloom" });
  try {
    await t.go("/settings");
    const selected = await t.eval('document.querySelector("button.bbx-system-theme-button[aria-label=Bloom]")?.getAttribute("aria-pressed")');
    await t.expect.custom("Bloom selection survives navigation", () => selected.trim() === '"true"');
    await t.checkpoint("bloom-selected");
    await t.go("/chat?session=new&engine=codex&card=_content%2Ftheme-tour%2Fbloom-inherited.memo.card");
    await t.expect.heading("A little room to grow", { level: 2 });
    const inherited = await t.eval('document.querySelector(".bbx-card-surface[data-card-theme=bloom]") !== null');
    await t.expect.custom("unthemed card inherits Bloom", () => inherited.trim() === "true");
    await t.checkpoint("bloom-workspace");
    await t.expect.noPageErrors();
    await t.go("/chat?session=new&engine=codex");
    await t.expect.landmark("Compose message");
    await t.click({ role: "button", name: "Add" });
    await t.checkpoint("bloom-composer-menu");
    await t.go("/views/_content/theme-tour/bloom-explicit.memo.card");
    await t.expect.heading("A note on blue paper", { level: 2 });
    await t.checkpoint("explicit-paper-on-bloom");
    await t.expect.noPageErrors();
  } finally {
    await t.go("/settings");
    await t.eval('document.querySelector("[id^=bbx-box-system-theme-default]")?.scrollIntoView({block: "center"})');
    await t.click({ role: "button", name: "Use default" });
  }
});
