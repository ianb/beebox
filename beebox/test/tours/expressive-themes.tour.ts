/** Real authored card materials with temporary DOM-only system previews.
 * Does not save settings, edit cards, send messages, or verify persistence.
 * The runner captures each preview at desktop and phone widths. */
import { tour } from "./tour-lib/registry.js";

tour({ name: "expressive-themes", description: "Authored expressive card materials on the same note, with DOM-only system previews." }, async (t) => {
  for (const [name, stock] of [
    ["harlequin", "pigment"],
    ["electric-playground", "prism"],
    ["daydream", "cloud"],
    ["selvedge", "wool"],
    ["footlights", "marquee"],
    ["overpass", "silhouette"],
    ["golden-hour", "canopy"],
    ["blacklight", "ink"],
    ["far-horizon", "gouache"],
  ]) {
    const heading = name === "footlights" ? "A ROOM FOR USEFUL THINGS" : "A room for useful things";
    await t.go(`/views/_content/theme-tour/expressive-${name}.memo.card`);
    await t.expect.heading(heading, { level: 2 });
    const preview = await t.eval(`(() => {
      const root = document.querySelector('.bbx-box-presentation');
      const card = [...document.querySelectorAll('.bbx-card-surface')].find((surface) =>
        surface.getBoundingClientRect().width > 0 && surface.getBoundingClientRect().height > 0);
      if (!root || !card) return false;
      root.dataset.chromeTheme = ${JSON.stringify(name)};
      root.dataset.chromeStock = ${JSON.stringify(stock)};
      root.dataset.themeComposition = 'expressive';
      const style = getComputedStyle(card);
      const nav = document.querySelector('.bbx-app-nav');
      const navStyle = nav && getComputedStyle(nav);
      return card.dataset.cardTheme === ${JSON.stringify(name)} &&
        card.dataset.defaultBlockquoteTreatment === 'inset' &&
        style.getPropertyValue('--bbx-sheet-shadow').trim() !== '' &&
        style.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
        getComputedStyle(root).backgroundImage !== 'none' &&
        !!navStyle && (navStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' || navStyle.backgroundImage !== 'none') &&
        document.documentElement.scrollWidth <= innerWidth;
    })()`);
    await t.expect.custom(`${name}: opaque material, painted scene and nav, no page overflow`, () => preview.trim() === "true");
    await t.expect.heading(heading, { level: 2 });
    await t.expect.custom(`${name}: note preserves headings, list, quote and link`, (snapshot) =>
      snapshot.includes("The morning table") && snapshot.includes("three promising sketches") &&
      snapshot.includes("Give the work a little space") && snapshot.includes("studio inventory"));
    await t.expect.noPageErrors();
    await t.checkpoint(`${name}-css-preview`);
  }
});
