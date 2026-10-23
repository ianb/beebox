// # Source chip labels for chat cards
//
// A `{% source %}` chip that cites a chat reads "chat, Oct 22" (from the file
// name; no card read), not the file name with its id. The `usage` word goes to
// the tooltip in plain words.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { chatRefLabel, chatUsageWords, refLabel } from "../../src/lib/ref-label.js";

void test("a chat ref is labelled by its date, and other refs keep their label", async (t) => {
  t.check(
    [
      chatRefLabel("/_content/chat/web/2026-10-22_0bda0c7a.chat.card"),
      chatRefLabel("_content/chat/web/2026-01-05_ab12cd34.chat.card#m4"),
      chatRefLabel("/_content/chat/web/renamed.chat.card"),
      chatRefLabel("/_content/inbox/Voice_2026-03-15.doc.card"),
      refLabel("/_content/inbox/Voice_2026-03-15.doc.card"),
    ],
    [
      { label: "chat, Oct 22", isoDate: "2026-10-22" },
      { label: "chat, Jan 5", isoDate: "2026-01-05" },
      null,
      null,
      "Voice 2026 03 15",
    ],
  );
});

void test("usage words read plainly; unknown words pass through", async (t) => {
  t.check(
    ["verbatim", "paraphrase", "summary", "inferred from her email"].map(chatUsageWords),
    ["your words", "paraphrased", "summarized", "inferred from her email"],
  );
});
