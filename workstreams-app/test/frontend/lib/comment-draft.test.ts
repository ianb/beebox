import { test } from "tap";
import "@ianbicking/tap-check/tap";

import { appendCommentTranscript, commentBody, commentDraftText } from "../../../src/frontend/lib/comment-draft.js";

void test("A picked quote is editable in the input but is not repeated in the saved note", async (t) => {
  const anchor = { quoted: "First line\nSecond line", fragment: ":~:text=First" };
  const draft = commentDraftText(anchor);
  t.check(draft, "> First line\n> Second line\n\n");
  t.check(commentBody(appendCommentTranscript(draft, "The chart is cropped."), anchor), "The chart is cropped.");
  t.check(commentBody(draft, anchor), "");
  t.check(commentBody("> Edited context\n\nThe chart is cropped.", anchor), "> Edited context\n\nThe chart is cropped.");
});
