// # Source-scoped activity stays available until acceptance
//
// A cancelled or failed send needs no restoration: capture did not erase anything.
// Switching subjects cannot carry old activity onto the new card, and an older
// receipt cannot erase activity recorded after its send gesture.

import { test } from "tap";
import "agent-doctest/tap";
import { CardActivityStore } from "../../../../src/components/chat/conversation/card-activity-store.js";

void test("line 11", async (t) => {
  // doctest:L12
  const activity = new CardActivityStore();
  const first = "_content/house/Energy.doc.card?view=costs";
  const second = "_content/kitchen/Plan.doc.card";
  activity.report(first, { kind: "modified", detail: "Updated cost" });
  const cancelled = activity.capture(first);
  t.check(activity.capture(first), {
    openCard: "_content/house/Energy.doc.card",
    cardActivity: [
      "modified",
    ],
    cardState: {
      modified: "Updated cost",
    },
  });

  // doctest:L20
  t.check(activity.capture(second), {
    openCard: "_content/kitchen/Plan.doc.card",
  });

  // doctest:L23
  activity.report(second, { kind: "scrolled", detail: "0.7" });
  activity.report(first, { kind: "modified", detail: "Updated cost again" });
  activity.accepted(cancelled);
  t.check(activity.capture(first), {
    openCard: "_content/house/Energy.doc.card",
    cardActivity: [
      "modified",
    ],
    cardState: {
      modified: "Updated cost again",
    },
  });

  t.check(activity.capture(second), {
    openCard: "_content/kitchen/Plan.doc.card",
    cardActivity: [
      "scrolled",
    ],
    cardState: {
      scrolled: "0.7",
    },
  });

  // doctest:L32
  const final = activity.capture(first);
  activity.accepted(final);
  t.check(activity.capture(first), {
    openCard: "_content/house/Energy.doc.card",
  });

  t.check(activity.capture(second), {
    openCard: "_content/kitchen/Plan.doc.card",
    cardActivity: [
      "scrolled",
    ],
    cardState: {
      scrolled: "0.7",
    },
  });

  // doctest:L40
  t.check(activity.capture("_content/house/Energy.doc.card?view=summary"), {
    openCard: "_content/house/Energy.doc.card",
  });

  // doctest:L43
  t.check(activity.capture(undefined), {});
});
