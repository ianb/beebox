/** Card edges stay visible when a file opens beside the full-width Browse listing. */
import { tour } from "./tour-lib/index.js";

tour(
  { name: "card-theme-interface", description: "Inspect a card opened from Browse at desktop and phone widths." },
  async (t) => {
    await t.go("/browse/_content/theme-tour/comparison-paper.memo.card");
    await t.expect.heading("One note, three stocks", { level: 2 });
    await t.checkpoint("browse-card-desk");
    const framed = await t.eval(`(() => {
      const desk = document.querySelector(".bbx-interface-card-desk");
      const card = desk?.querySelector(".bbx-card-surface");
      if (!desk || !card) return false;
      const d = desk.getBoundingClientRect(), c = card.getBoundingClientRect();
      return c.left - d.left >= 12 && d.right - c.right >= 12 &&
        document.documentElement.scrollWidth <= innerWidth &&
        document.querySelectorAll('[data-workspace-card="_config/interface/browse.card"]').length === 1;
    })()`);
    await t.expect.custom("card has visible desk, one heading, and no horizontal page overflow", () => framed.trim() === "true");
    await t.eval(`(() => {
      const paragraph = document.querySelector('[data-workspace-card="_content/theme-tour/comparison-paper.memo.card"] .bbx-paragraph');
      if (!paragraph) throw new Error("Workspace card paragraph is missing");
      paragraph.scrollIntoView({ block: "center", behavior: "instant" });
      paragraph.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    })()`);
    await t.expect.button("Add selection to message");
    const selectionButtons = await t.eval('document.querySelectorAll("#bbx-selection-add").length');
    await t.expect.custom("workspace card owns one selection button", () => selectionButtons.trim() === "1");
    await t.eval("getSelection()?.removeAllRanges()");
    await t.expect.noPageErrors();
  },
);
