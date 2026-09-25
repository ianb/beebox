/** A retained card can move, focus, and yield to chat without losing its view. */
import { tour } from "./tour-lib/index.js";

tour({ name: "workspace-panes", description: "Pane controls, retained cards, and single-pane phone chat." }, async (t) => {
  await t.go("/chat?session=new&engine=codex&card=_content%2Ftheme-tour%2FTheme_Tour.memo.card");
  await t.expect.heading("Card themes tour", { level: 2 });
  await t.checkpoint("card-beside-conversation");
  await t.click({ role: "button", name: "Minimize cards" });
  await t.checkpoint("conversation-with-floating-restore");
  await t.click({ role: "button", name: /^Restore cards/ });
  await t.expect.heading("Card themes tour", { level: 2 });
  const visible = await t.eval("[...document.querySelectorAll(\"[data-workspace-card]\")].filter(n => !n.hidden).length");
  await t.expect.custom("restoring exposes exactly one retained card", () => visible.trim() === "1");
  const currentUrl = (await t.eval("location.href")).trim().replace(/^"|"$/g, "");
  await t.expect.custom("workspace serializes the canonical card target", () => currentUrl.includes("/chat?") && currentUrl.includes("card=_content%2Ftheme-tour%2FTheme_Tour.memo.card"));
  await t.go(currentUrl);
  await t.expect.heading("Card themes tour", { level: 2 });
  await t.expect.button("Minimize cards");
  await t.checkpoint("restored-after-reload");
  const pending = await t.eval("history.state.bbxConversation?.target.clientConversationId ?? null");
  await t.click({ role: "link", name: "Paper / cream" });
  await t.expect.heading("One note, three stocks", { level: 2 });
  const after = await t.eval("history.state.bbxConversation?.target.clientConversationId ?? null");
  await t.expect.custom("card navigation retains the pending conversation", () => pending !== "null" && pending === after);
  const retained = await t.eval('document.querySelectorAll("[data-workspace-card]").length');
  await t.expect.custom("both cards remain retained before the first send", () => retained.trim() === "2");
  const canonicalPath = await t.eval("location.pathname.includes('/card/')");
  await t.expect.custom("linked-card navigation stays in the canonical workspace", () => canonicalPath.trim() === "false");
  await t.expect.noPageErrors();
});
