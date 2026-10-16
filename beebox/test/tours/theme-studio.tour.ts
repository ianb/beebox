/** Fixed development specimens, not a walk through live navigation or chat behavior. */
import { tour } from "./tour-lib/registry.js";

tour({ name: "theme-studio", description: "Draft theme on fixed card and composer specimens." }, async (t) => {
  await t.go("/dev/theme-studio?system=draft&card=draft");
  await t.expect.heading("Theme studio", { level: 1 });
  await t.checkpoint("draft-theme");
  await t.eval('document.getElementById("studio-reading")?.scrollIntoView({block: "start"})');
  await t.expect.heading("A little room to grow", { level: 2 });
  await t.checkpoint("card-material");
  await t.expect.noPageErrors();
});
