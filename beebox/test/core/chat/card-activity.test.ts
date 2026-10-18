// # Companion-pane card activity
//
// `src/core/chat/card-activity.ts` holds the vocabulary for what the user did to
// the card open in the chat's two-pane companion layout. The four kinds project
// onto a canonical order (`scrolled`, `navigated`, `explored`, `modified`) for
// both the snapshot attribute and the queued-send union.

import { test } from "tap";
import "agent-doctest/tap";
import {
  unionActivityKinds,
  renderActivityChildren,
  mergeCardStateDetails,
} from "../../../src/core/chat/card-activity.js";
import { combineQueuedInputs } from "../../../src/core/chat/session/state.js";

// ## Rendering the snapshot children
//
// `renderActivityChildren` emits one `<card-activity>` element per kind, in
// canonical order, dropping unrecognized kinds. A kind with a detail carries it as
// element text (XML-escaped); without one it's self-closing. Nothing to render
// gives `""` so the caller keeps `<chat-app>` self-closing.
//
// Two kinds are suppressed as redundant noise: a detail-less `scrolled` (it has no
// *where*), and a `navigated` whose target is the card already named by `openCard`.
void test("renderActivityChildren emits one <card-activity> element per kind, in canonic...", async (t) => {
  // doctest:L28
  await t.checkText(
    // scrolled carries no detail today, so it's dropped rather than emitted bare
    JSON.stringify(renderActivityChildren({ kinds: ["scrolled"], details: {} })),
    "\"\"",
  );

  // doctest:L32
  t.check(renderActivityChildren({ kinds: ["explored"], details: { explored: "boat-water+road -> boats" } }), "<card-activity kind=\"explored\">boat-water+road -> boats</card-activity>");

  // doctest:L35
  t.check(renderActivityChildren({ kinds: ["bogus"], details: {} }), "");
});

// `navigated` is dropped when it just restates the open card, and kept when it
// points somewhere else.
void test("navigated is dropped when it just restates the open card, and kept when it po...", async (t) => {
  // doctest:L43
  await t.checkText(
    // redundant with the open-card attribute → suppressed
    JSON.stringify(renderActivityChildren({
      kinds: ["navigated"],
      details: { navigated: "_content/a.card" },
      openCard: "_content/a.card",
    })),
    "\"\"",
  );

  // doctest:L51
  t.check(
    renderActivityChildren({
      kinds: ["navigated"],
      details: { navigated: "_content/b.card" },
      openCard: "_content/a.card",
    }),
    "<card-activity kind=\"navigated\">_content/b.card</card-activity>",
  );
});

// Multiple kinds come out in canonical order regardless of arrival order, one per
// line; detail text is escaped. The detail-less `scrolled` here is suppressed,
// leaving only the useful `explored`.
void test("Multiple kinds come out in canonical order regardless of arrival order, one p...", async (t) => {
  // doctest:L64
  t.check(renderActivityChildren({ kinds: ["explored", "scrolled"], details: { explored: "a < b & c" } }), "<card-activity kind=\"explored\">a &lt; b &amp; c</card-activity>");
});

// ## Unioning across queued sends
//
// `unionActivityKinds` merges several lists into one canonical-ordered list,
// dropping unrecognized kinds. It backs the queued-send combine so an earlier
// queued message's activity is never lost.
void test("unionActivityKinds merges several lists into one canonical-ordered list, drop...", async (t) => {
  // doctest:L75
  t.check(unionActivityKinds([["scrolled"], ["modified"], undefined]), [
    "scrolled",
    "modified",
  ]);

  // doctest:L78
  t.check(unionActivityKinds([["modified", "navigated"], ["modified"]]), [
    "navigated",
    "modified",
  ]);
});

// ## Per-kind detail (card-state)
//
// `reportActivity(kind, detail)` attaches a free-text detail per kind, carried as
// the `<card-activity>` element text. `mergeCardStateDetails` merges detail maps
// latest-wins per kind, dropping unrecognized kinds and empty strings — so a later
// queued send's detail for a kind overrides an earlier one.
void test("reportActivity(kind, detail) attaches a free-text detail per kind, carried as...", async (t) => {
  // doctest:L90
  t.check(
    mergeCardStateDetails([
      { explored: "boa" },
      { explored: "boat", modified: "x.card" },
    ]),
    {
    explored: "boat",
    modified: "x.card",
  },
  );

  // doctest:L96
  // Detail maps arrive from clients, so a kind the server does not know can be in one.
  const fromWire: Record<string, string> = { bogus: "y" };
  t.check(mergeCardStateDetails([fromWire, { explored: "" }]), {});
});

// ## Combining queued inputs
//
// `combineQueuedInputs` joins text, renumbers image tokens, and for the
// companion-pane fields takes the **latest** `openCard` (where the user is now)
// but the **union** of `cardActivity` — a later send reporting only "modified"
// must not clobber an earlier "scrolled".
void test("combineQueuedInputs joins text, renumbers image tokens, and for the companion...", async (t) => {
  // doctest:L110
  const combined = combineQueuedInputs([
    { text: "first", openCard: "a.card", cardActivity: ["scrolled", "explored"], cardState: { explored: "bo" } },
    { text: "second", openCard: "b.card", cardActivity: ["modified"], cardState: { explored: "boat" } },
  ]);
  t.check(combined.text, `first

second`);

  // doctest:L117
  t.check(combined.openCard, "b.card");

  // doctest:L120
  t.check(combined.cardActivity, [
    "scrolled",
    "explored",
    "modified",
  ]);

  // doctest:L123
  t.check(combined.cardState, {
    explored: "boat",
  });
});

// When no queued send carries companion-pane state, both fields are absent (not
// empty) so the snapshot omits them.
void test("When no queued send carries companion-pane state, both fields are absent (not...", async (t) => {
  // doctest:L131
  const plain = combineQueuedInputs([{ text: "a" }, { text: "b" }]);
  t.check(plain.openCard ?? null, null);

  // doctest:L135
  t.check(plain.cardActivity ?? null, null);
});
