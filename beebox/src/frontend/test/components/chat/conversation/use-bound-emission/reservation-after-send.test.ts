// # A send retires a fresh chat's reservation unless the box refused it
//
// A send that may have reached the box retires the tab's reservation receipt,
// so a later reload never re-reserves a used (possibly deleted) chat. A
// definitive refusal recorded nothing; the receipt survives so a retry, even
// after a restart forgot the box's reservation, starts the chat.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { sendSpendsReservation } from "../../../../../src/components/chat/conversation/use-bound-emission/reservation-after-send.js";

void test("only a definitive refusal keeps the reservation", (t) => {
  t.check({
    sent: sendSpendsReservation({ disposition: "sent", emissionId: "e", deduplicated: false }),
    queued: sendSpendsReservation({ disposition: "queued", emissionId: "e" }),
    uncertain: sendSpendsReservation({ disposition: "rejected", emissionId: "e", reason: "network" }),
    refused: sendSpendsReservation({ disposition: "rejected", emissionId: "e", reason: "Box is closed", definitive: true }),
  }, { sent: true, queued: true, uncertain: true, refused: false });
  t.end();
});
