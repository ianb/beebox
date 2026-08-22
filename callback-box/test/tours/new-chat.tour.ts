/**
 * New-chat tour: a chat opened with `?session=new` coins its own id and has the
 * box reserve it, so the composer's chat-scoped affordances are live before the
 * first message exists.
 *
 * This is the walk that would have caught the filed issue
 * (`issues/features/2026-08-20-cannot-capture-into-a-new-chat.md`): capture used
 * to render as "Capture… (send a message first)" until the harness had named the
 * chat, which made the most natural way to start a conversation — open a chat,
 * put the photos in — impossible.
 */

import { tour } from "./tour-lib/index.js";

tour(
  { name: "new-chat", description: "Open a brand-new chat and check it is addressable before its first message." },
  async (t) => {
    await t.go("/chat?session=new");
    await t.checkpoint("fresh-chat");

    await t.expect.heading("Chat", { level: 1 });
    await t.expect.button("Add");

    // The sentinel is gone from the URL by the time the chat renders: the page
    // holds its shell until the reservation settles, then navigates to the
    // coined id. A chat still showing `session=new` here means coining failed
    // (or the box is Codex, which names its own threads).
    const search = await t.eval("location.search");
    await t.expect.custom(`the URL carries a coined session id, not the "new" sentinel (got ${search})`, () =>
      !search.includes("session=new"));

    await t.click({ role: "button", name: "Add" });
    await t.checkpoint("add-menu");

    // The gates read `sessionId === null`, so on a box that coins ids these
    // items must never render their disabled form.
    await t.expect.custom("Capture is offered, not deferred to a first message", (snapshot) =>
      snapshot.includes("Capture…") && !snapshot.includes("send a message first"));
    await t.expect.custom("Upload files is offered too", (snapshot) =>
      snapshot.includes("Upload files…") && !snapshot.includes("Upload files… (send"));
  },
);
