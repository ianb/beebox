// # Chat message sender identity
//
// Message ownership compares like identity fields. A stale entry without the
// normalized email may fall back to its display name, but never compares that
// name to the signed-in user's email.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isOtherChatUser } from "../../../../src/components/chat/user-message/chat-message-sender.js";

void test("line 11", async (t) => {
  // doctest:L12
  t.check(isOtherChatUser({ senderEmail: "ian@example.com", senderName: "Ian", currentUserEmail: "ian@example.com", currentUserName: "Ian" }), false);

  // doctest:L15
  t.check(isOtherChatUser({ senderEmail: undefined, senderName: "Ian", currentUserEmail: "ian@example.com", currentUserName: "Ian" }), false);

  // doctest:L18
  t.check(isOtherChatUser({ senderEmail: undefined, senderName: "Other", currentUserEmail: "ian@example.com", currentUserName: "Ian" }), true);

  // doctest:L21
  t.check(isOtherChatUser({ senderEmail: "other@example.com", senderName: "Ian", currentUserEmail: "ian@example.com", currentUserName: "Ian" }), true);

  // doctest:L24
  t.check(isOtherChatUser({ locallyAuthored: true, senderEmail: undefined, senderName: "Ian", currentUserEmail: "ian@example.com", currentUserName: "Ian Bicking" }), false);

  // doctest:L27
  t.check(isOtherChatUser({ senderEmail: undefined, senderName: null, currentUserEmail: "ian@example.com", currentUserName: "Ian" }), false);
});
