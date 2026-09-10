/** Cards opened from links must retain their own edges inside the preview. */
import { tour } from "./tour-lib/index.js";

tour(
  { name: "card-theme-previews", description: "Inspect complete cards on the preview desk, including long content." },
  async (t) => {
    await t.go("/views/_content/theme-tour/Theme_Tour.memo.card");
    await t.expect.heading("Card themes tour", { level: 1 });
    for (const name of ["Paper / cream", "Paper / manila", "Post-it / yellow", "Plain / neutral", "Long content"]) {
      await t.eval(`(() => {
        const link = [...document.querySelectorAll("a")].find((item) => item.textContent === ${JSON.stringify(name)});
        link?.scrollIntoView({ block: "center", behavior: "instant" });
      })()`);
      await t.click({ role: "link", name });
      await t.expect.button("Close preview");
      await t.checkpoint(`preview-${name.toLowerCase().replaceAll(" / ", "-").replaceAll(" ", "-")}`);
      const inset = await t.eval(`(() => {
        const desk = document.querySelector(".bbx-card-overlay-desk");
        const card = desk?.querySelector(".bbx-card-surface");
        if (!desk || !card) return false;
        const d = desk.getBoundingClientRect(), c = card.getBoundingClientRect();
        return c.left - d.left >= 12 && d.right - c.right >= 12 && c.top - d.top >= 8;
      })()`);
      await t.expect.custom("preview leaves visible desk around the card", () => inset.trim() === "true");
      const turn = await t.eval(`(() => {
        const button = document.querySelector(".bbx-card-overlay-desk .bbx-card-properties");
        if (!button) return false;
        const box = button.getBoundingClientRect();
        return button.offsetWidth === 44 && button.offsetHeight === 44 &&
          button.getAttribute("aria-label") === "Properties" && box.width >= 44;
      })()`);
      await t.expect.custom("Properties uses the same corner control in every theme", () => turn.trim() === "true");
      if (name !== "Long content") {
        const layered = name !== "Plain / neutral";
        const quotes = await t.eval(`(() => {
          const quotes = [...document.querySelectorAll(".bbx-card-overlay-desk .bbx-blockquote, .bbx-card-overlay-desk .bbx-quote-block")];
          return quotes.length === 2 && quotes.every((quote) =>
            getComputedStyle(quote, "::before").display === ${JSON.stringify(layered ? "block" : "none")});
        })()`);
        await t.expect.custom("both quote forms follow the selected theme", () => quotes.trim() === "true");
      }
      await t.expect.noPageErrors();
      await t.click({ role: "button", name: "Close preview" });
    }
  },
);
