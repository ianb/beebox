// # View param resolution — the override cascade with provenance
//
// View-card params merge through a cascade — card frontmatter overlaid per
// key by URL query params — and views receive `{ values, origins, card }`:
// merged values, per-key provenance, and the card layer retained for
// diff/reset. See docs/plans/interface-as-cards.md ("Runtime param
// overrides, with provenance").

import { test } from "tap";
import "agent-doctest/tap";
import {
  resolveViewParams,
  HISTORY_QUERY_CODEC,
} from "../../src/shared/named-views.js";

// ## Card params alone: everything originates from the card
void test("Card params alone: everything originates from the card", async (t) => {
  // doctest:L19
  const r = resolveViewParams({
    card: { feedback: true, connectors: ["gmail"] },
    query: {},
    codec: HISTORY_QUERY_CODEC,
  });
  t.check(r.values, {
    feedback: true,
    connectors: [
      "gmail",
    ],
  });

  // doctest:L27
  t.check(r.origins, {
    feedback: "card",
    connectors: "card",
  });
});

// ## URL params overlay per key, and provenance says which
//
// An explicit `false` in the URL can switch off a card's `true` — the
// override spelling for booleans.
void test("An explicit false in the URL can switch off a card's true — the override spel...", async (t) => {
  // doctest:L37
  const r = resolveViewParams({
    card: { feedback: true, connectors: ["gmail"] },
    query: { session: "abc123", feedback: "false" },
    codec: HISTORY_QUERY_CODEC,
  });
  t.check(r.values, {
    feedback: false,
    connectors: [
      "gmail",
    ],
    session: "abc123",
  });

  // doctest:L45
  t.check(r.origins, {
    feedback: "url",
    connectors: "card",
    session: "url",
  });

  // doctest:L48
  t.check(r.card, {
    feedback: true,
    connectors: [
      "gmail",
    ],
  });
});

// ## The codec reads only its declared keys; lists ride comma-separated
//
// Renderer plumbing injects extras (`path`, `view`) into query params —
// codecs must ignore them.
void test("Renderer plumbing injects extras (path, view) into query params — codecs must...", async (t) => {
  // doctest:L58
  t.check(
    HISTORY_QUERY_CODEC.fromQuery({
      connector: "gmail,rss",
      path: "Feedback_Commits.view.card",
      view: "history",
    }),
    {
    connectors: [
      "gmail",
      "rss",
    ],
  },
  );

  // doctest:L65
  t.check(HISTORY_QUERY_CODEC.toQuery({ connectors: ["gmail", "rss"], touchpoint: true }), {
    connector: "gmail,rss",
    touchpoint: "true",
  });
});

// ## Without a codec, URL params are ignored entirely
void test("Without a codec, URL params are ignored entirely", async (t) => {
  // doctest:L72
  const r = resolveViewParams({
    card: { feedback: true },
    query: { session: "abc123" },
  });
  t.check(r.origins, {
    feedback: "card",
  });
});
