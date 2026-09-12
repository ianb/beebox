/**
 * Card-theme visual walk. The seed cards are generic fictional examples so
 * this tour survives box refreshes and can be used while the theme host grows.
 * It reaches the real preferred card views; theme controls, Properties, tabs,
 * and the explicit stack experiment become richer as those surfaces land.
 */

import { tour, type TourContext } from "./tour-lib/index.js";

const CARD = "/views/_content/theme-tour/";

tour(
  { name: "card-themes", description: "Walk the persistent card-theme gallery across short, dense, quoted, and structured cards." },
  async (t) => {
    await t.go(`${CARD}Theme_Tour.memo.card`);
    // The first card can cold-start the box; an expectation waits for the
    // settled card before the visual checkpoint captures it.
    await t.expect.heading("Card themes tour", { level: 1 });
    await t.checkpoint("entry-point");
    await t.expect.heading("Card themes tour", { level: 1 });
    await t.expect.noPageErrors();

    await t.go("/views/_content/theme-tour/markdown-note.md");
    await t.checkpoint("markdown-file");
    await t.expect.heading("A Markdown file", { level: 1 });
    await t.expect.custom("Markdown file uses the themed document surface", (snapshot) =>
      snapshot.includes("Properties") && snapshot.includes("ordinary Markdown document"));
    await t.expect.noPageErrors();

    await t.go("/chat?session=new&engine=codex&card=_content%2Ftheme-tour%2Fmarkdown-note.md");
    await t.expect.heading("A Markdown file", { level: 1 });
    await t.checkpoint("markdown-workspace");
    const joined = await t.eval(`(() => {
      const pane = document.querySelector('[data-workspace-card="_content/theme-tour/markdown-note.md"]');
      const desk = pane?.querySelector('.bbx-interface-card-desk[aria-hidden="false"]');
      const surface = desk?.querySelector(':scope > .bbx-card-surface');
      const tab = pane?.querySelector('.bbx-interface-tab[data-active="true"]');
      if (!pane || !desk || !surface || !tab) return false;
      const deskStyle = getComputedStyle(desk);
      return pane.hasAttribute("data-active-card") && desk.dataset.cardContent === "card" &&
        parseFloat(deskStyle.paddingLeft) >= 12 &&
        getComputedStyle(pane).getPropertyValue("--bbx-material-width").trim() !== "";
    })()`);
    await t.expect.custom("Markdown tab joins the themed sheet with workspace gutters", () => joined.trim() === "true");
    await t.expect.noPageErrors();

    for (const [name, heading, stock] of [
      ["comparison-paper.memo.card", "One note, three stocks", "cream"],
      ["comparison-post-it.memo.card", "One note, three stocks", "yellow"],
      ["comparison-plain.memo.card", "One note, three stocks", "neutral"],
    ] as const) {
      await t.go(`${CARD}${name}`);
      await t.checkpoint(`same-content-${stock}`);
      await t.expect.heading(heading, { level: 1 });
      await t.expect.noPageErrors();
    }

    await t.go(`${CARD}comparison.memo.card`);
    await t.checkpoint("theme-comparison");
    await t.expect.heading("One note, three stocks", { level: 1 });
    await t.expect.custom("comparison content is visible", (snapshot) => snapshot.includes("clay samples") && snapshot.includes("Rowan Vale"));
    await t.expect.noPageErrors();

    // The swatch picker is on the card's back. Exercise a real save, then
    // reopen Properties to prove the choice survives the card refresh.
    await clickVisibleButton(t, "Properties");
    await t.checkpoint("properties");
    await t.expect.heading("Properties", { level: 2 });
    await t.expect.custom("Properties exposes appearance and reset", (snapshot) =>
      snapshot.includes("Theme") && snapshot.includes("Stock") && snapshot.includes("Choose card appearance") && snapshot.includes("Use default"));
    await clickVisibleButton(t, "Sticky note — yellow");
    await t.checkpoint("saved-post-it");
    await t.expect.custom("saved stock is reflected in the card surface", (snapshot) => snapshot.includes("post-it") || snapshot.includes("yellow"));
    await clickVisibleButton(t, "Return to card");
    await clickVisibleButton(t, "Properties");
    await t.expect.custom("saved stock persists after returning to Properties", (snapshot) => snapshot.includes("post-it") && snapshot.includes("yellow"));
    await clickVisibleButton(t, "Use default");
    await t.checkpoint("use-default");
    await t.expect.custom("Use default returns to the resolved fallback", (snapshot) => snapshot.includes("Following the box and card type defaults."));
    await t.expect.noPageErrors();

    await t.go(`${CARD}mixed-stocks.memo.card`);
    await t.checkpoint("mixed-stocks");
    await t.expect.heading("Mixed stocks", { level: 1 });
    await t.expect.custom("mixed stock links are visible", (snapshot) => snapshot.includes("Rose Post-it") && snapshot.includes("Mint Post-it"));
    await t.expect.noPageErrors();

    await t.go(`${CARD}quotes.memo.card`);
    await t.checkpoint("quotes");
    await t.expect.heading("Quotes and attribution", { level: 1 });
    await t.expect.custom("quote attribution remains visible", (snapshot) => snapshot.includes("Rowan Vale"));
    await t.expect.noPageErrors();

    await t.go(`${CARD}structured.record.card`);
    await t.checkpoint("structured");
    await t.expect.heading("Lantern inventory", { level: 1 });
    await t.expect.custom("structured properties remain visible", (snapshot) => snapshot.includes("matching lamps"));
    await t.expect.noPageErrors();

    await t.go(`${CARD}long-form.memo.card`);
    await t.checkpoint("long-content");
    await t.expect.heading("Long content and dense edges", { level: 1 });
    await t.expect.custom("dense content reaches its image", (snapshot) => snapshot.includes("A simple geometric test image"));
    await t.expect.noPageErrors();

    await t.go(`${CARD}stack-experiment.memo.card`);
    await t.checkpoint("stack-experiment");
    await t.expect.heading("Tucked-card experiment", { level: 1 });
    await t.expect.custom("stack experiment is explicitly labeled", (snapshot) => snapshot.includes("static composition study") && snapshot.includes("does not currently choose related cards"));
    await t.expect.noPageErrors();
  },
);

async function clickVisibleButton(t: TourContext, name: string): Promise<void> {
  await t.eval(`(() => {
    const button = [...document.querySelectorAll("button")].find((item) =>
      (item.getAttribute("aria-label") ?? item.textContent.trim()) === ${JSON.stringify(name)});
    button?.scrollIntoView({ block: "center", behavior: "instant" });
  })()`);
  await t.click({ role: "button", name });
}
