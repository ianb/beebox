// # Opener sends are accepted or rejected
//
// Clicking an opener is typing it and pressing enter. Before this decision
// existed, a click wrote the opener into the composer (clobbering a half-typed
// draft) and the send could then decline silently, while the opener buttons had
// already disabled themselves. `openerSendDecision` decides first, with nothing
// written: the click is rejected, with a message for the person, when the
// composer holds a draft, when a send is still in flight, or when the chat
// cannot send yet. Otherwise it is accepted.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { openerSendDecision } from "../../../src/components/openers/opener-send.js";

// An empty or whitespace-only composer accepts the opener.
void test("An empty or whitespace-only composer accepts the opener.", async (t) => {
  t.check(
    ({ empty: openerSendDecision({ draft: "", inFlight: false, disabledReason: undefined }),
      blank: openerSendDecision({ draft: "  \n", inFlight: false, disabledReason: undefined }) }),
    {
    empty: {
      outcome: "accepted",
    },
    blank: {
      outcome: "accepted",
    },
  },
  );
});

// A half-typed draft rejects it; the person's words stay where they are.
void test("A half-typed draft rejects it; the person's words stay where they are.", async (t) => {
  t.check(openerSendDecision({ draft: "Bram says he", inFlight: false, disabledReason: undefined }), {
    outcome: "rejected",
    message: "Send or clear your draft first.",
  });
});

// The two cases where the send funnel would otherwise return silently are
// rejections too, each with its own message.
void test("The two cases where the send funnel would otherwise return silently are rejec...", async (t) => {
  t.check(
    ({ inFlight: openerSendDecision({ draft: "", inFlight: true, disabledReason: undefined }),
      disabled: openerSendDecision({ draft: "", inFlight: false, disabledReason: "Choosing conversation…" }) }),
    {
    inFlight: {
      outcome: "rejected",
      message: "Wait for the message that is sending.",
    },
    disabled: {
      outcome: "rejected",
      message: "Choosing conversation…",
    },
  },
  );
});
