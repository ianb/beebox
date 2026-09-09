/** System appearance is selectable independently of a landmark card's theme. */
import { tour } from "./tour-lib/index.js";

tour({ name: "system-themes", description: "Box and landmark system-theme swatches." }, async (t) => {
  await t.go("/settings");
  await t.expect.heading("System theme", { level: 2 });
  await t.expect.button("Paper — Slate");
  await t.expect.button("Use default");
  await t.checkpoint("box-system-theme");
  await t.go("/chat?session=new&engine=codex&contextDir=_content%2Ftheme-tour&card=_content%2Ftheme-tour%2FTheme_Tour.landmark.card");
  await t.expect.button("Properties");
  await t.click({ role: "button", name: "Properties" });
  await t.expect.heading("System theme", { level: 3 });
  await t.expect.button("Use box default");
  await t.eval('document.querySelector(".bbx-landmark-system-theme")?.scrollIntoView({block:"center"})');
  await t.checkpoint("landmark-system-theme");
  await t.expect.noPageErrors();
});
