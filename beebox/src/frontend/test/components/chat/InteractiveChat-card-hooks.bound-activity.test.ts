// # Each companion card reports under its own source
//
// The workspace used to pass one focused-card reporter to every mounted
// card, so a figure still running in the other pane reported under the
// focused card's name (plan docs/implemented-plans/figure-check.md, review decision
// "Attribution"). Each card now binds the reporter to its own activity
// source, the key a send from that card captures.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { bindCardActivity, cardActivitySource } from "../../../src/components/chat/InteractiveChat-card-hooks.js";
import { CardActivityStore } from "../../../src/components/chat/conversation/card-activity-store.js";

void test("a background card's report is captured with that card, not the focused one", async (t) => {
  const store = new CardActivityStore();
  const focused = { path: "_content/notes/Plan.doc.card", viewer: null, params: {}, viewState: null };
  const background = { path: "_content/physics/Scale.figure.card", viewer: null, params: {}, viewState: null };
  bindCardActivity((source, activity) => { store.report(source, activity); }, background)("explored", "set mass = 2");
  t.check({ focused: store.capture(cardActivitySource(focused)), background: store.capture(cardActivitySource(background)) }, {
    focused: { openCard: "_content/notes/Plan.doc.card" },
    background: {
      openCard: "_content/physics/Scale.figure.card",
      cardActivity: ["explored"],
      cardState: { explored: "set mass = 2" },
    },
  });
});
