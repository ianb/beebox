/** Cards opened from links retain their theme and edges in the workspace. */
import { tour } from "./tour-lib/index.js";

tour(
  { name: "card-theme-previews", description: "Inspect linked cards in the workspace, including long content." },
  async (t) => {
    await t.go("/views/_content/theme-tour/Theme_Tour.memo.card");
    await t.expect.heading("Card themes tour", { level: 2 });
    const cards = [
      { name: "Paper / cream", path: "comparison-paper.memo.card", theme: "paper", stock: "cream" },
      { name: "Paper / manila", path: "comparison-manila.memo.card", theme: "paper", stock: "manila" },
      { name: "Post-it / yellow", path: "comparison-post-it.memo.card", theme: "post-it", stock: "yellow" },
      { name: "Plain / neutral", path: "comparison-plain.memo.card", theme: "plain", stock: "neutral" },
      { name: "Long content", path: "long-form.memo.card", theme: "paper", stock: "manila" },
    ];
    for (const card of cards) {
      await t.eval(`(() => {
        const link = [...document.querySelectorAll("a")].find((item) => item.textContent === ${JSON.stringify(card.name)});
        link?.scrollIntoView({ block: "center", behavior: "instant" });
      })()`);
      await t.click({ role: "link", name: card.name });
      await t.checkpoint(`preview-${card.name.toLowerCase().replaceAll(" / ", "-").replaceAll(" ", "-")}`);
      const inset = await t.eval(`(() => {
        const root = [...document.querySelectorAll("[data-workspace-card]")].find((item) => !item.hidden && item.getAttribute("data-workspace-card")?.endsWith(${JSON.stringify(card.path)}));
        const desk = root?.querySelector(".bbx-interface-card-desk");
        const surface = desk?.querySelector(".bbx-card-surface");
        if (!desk || !surface) return false;
        const d = desk.getBoundingClientRect(), c = surface.getBoundingClientRect();
        return c.left - d.left >= 12 && d.right - c.right >= 12 && Math.abs(c.top - d.top) <= 1;
      })()`);
      await t.expect.custom("workspace keeps side gutters and joins the sheet to its tabs", () => inset.trim() === "true");
      const theme = await t.eval(`(() => {
        const root = [...document.querySelectorAll("[data-workspace-card]")].find((item) => !item.hidden && item.getAttribute("data-workspace-card")?.endsWith(${JSON.stringify(card.path)}));
        const surface = root?.querySelector(".bbx-card-surface");
        return surface?.getAttribute("data-card-theme") === ${JSON.stringify(card.theme)} && surface?.getAttribute("data-card-stock") === ${JSON.stringify(card.stock)};
      })()`);
      await t.expect.custom("linked card keeps its authored theme", () => theme.trim() === "true");
      const turn = await t.eval(`(() => {
        const button = [...document.querySelectorAll("[data-workspace-card]")].find((item) => !item.hidden && item.getAttribute("data-workspace-card")?.endsWith(${JSON.stringify(card.path)}))?.querySelector(".bbx-card-properties");
        if (!button) return false;
        const box = button.getBoundingClientRect();
        return button.offsetWidth === 44 && button.offsetHeight === 44 &&
          button.getAttribute("aria-label") === "Properties" && box.width >= 44;
      })()`);
      await t.expect.custom("Properties uses the same corner control in every theme", () => turn.trim() === "true");
      if (card.name !== "Long content") {
        const layered = card.name !== "Plain / neutral";
        const quotes = await t.eval(`(() => {
          const root = [...document.querySelectorAll("[data-workspace-card]")].find((item) => !item.hidden && item.getAttribute("data-workspace-card")?.endsWith(${JSON.stringify(card.path)}));
          const quotes = [...(root?.querySelectorAll(".bbx-blockquote, .bbx-quote-block") ?? [])];
          return quotes.length === 2 && quotes.every((quote) =>
            getComputedStyle(quote, "::before").display === ${JSON.stringify(layered ? "block" : "none")});
        })()`);
        await t.expect.custom("both quote forms follow the selected theme", () => quotes.trim() === "true");
      }
      await t.expect.noPageErrors();
      await t.go("/views/_content/theme-tour/Theme_Tour.memo.card");
      await t.expect.heading("Card themes tour", { level: 2 });
    }
  },
);
